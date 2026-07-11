#include <napi.h>
#include <string>
#include <vector>
#include <memory>
#include <thread>
#include <atomic>
#include <functional>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <fstream>
#include <sstream>
#include <chrono>
#include <algorithm>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <unistd.h>
#include <sys/wait.h>
#include <signal.h>
#include <fcntl.h>

// ─── Event types ────────────────────────────────────────────────────────────

struct CodexEvent {
    std::string id;
    uint64_t timestamp;
    std::string type;       // "prompt", "response", "tool_call", "approval_request", "diff", "error"
    std::string content;
    std::string session_id;
};

// ─── Codex CLI adapter ──────────────────────────────────────────────────────
// Spawns Codex CLI as a managed child process and parses its structured output.
// Falls back to PTY-based parsing if structured mode is unavailable.

class CodexSession {
public:
    pid_t pid = -1;
    std::string session_id;
    std::string repository;
    std::string branch;
    std::string provider;
    std::atomic<bool> running{false};
    std::atomic<bool> stopped{false};

    // Output callbacks (called from read thread)
    std::function<void(const CodexEvent&)> on_event;
    std::function<void(const std::string& stdout_data)> on_stdout;
    std::function<void(const std::string& stderr_data)> on_stderr;
    std::function<int(int exit_code, const std::string& signal)> on_exit;

    // Structured output buffer (for JSON-lines mode)
    std::string json_buffer;

    void start(const std::string& codex_path, const std::string& repo_path);
    void stop();
    bool is_running() const { return running.load(); }
    void send_input(const std::string& input);

private:
    // Parse a line of Codex output into events
    void parse_output_line(const std::string& line);
    // Parse JSON-lines structured output
    void parse_json_line(const std::string& json_str);
    // Spawn child process with PTY
    int spawn_process(const std::string& codex_path, const std::string& repo_path);
    // Read thread function
    void read_thread_func(int pty_fd);
};

// ─── Git operations (CLI wrapper) ───────────────────────────────────────────

struct GitStatusEntry {
    std::string x;       // index status
    std::string y;       // worktree status
    std::string path;
};

std::vector<GitStatusEntry> git_status(const std::string& repo_path);
std::string git_diff(const std::string& repo_path, const std::string& file_path);
std::string git_branch(const std::string& repo_path);
std::vector<std::string> git_log(const std::string& repo_path, int count = 20);

// ─── Event logging ──────────────────────────────────────────────────────────

bool append_event_log(const std::string& file_path, const CodexEvent& event);
std::string read_event_log(const std::string& file_path);

// ─── N-API bindings ─────────────────────────────────────────────────────────

class CodexAddon : public Napi::ObjectWrap<CodexAddon> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    CodexAddon(const Napi::CallbackInfo& info);

private:
    // Session management
    Napi::Value StartSession(const Napi::CallbackInfo& info);
    Napi::Value StopSession(const Napi::CallbackInfo& info);
    Napi::Value IsSessionRunning(const Napi::CallbackInfo& info);
    Napi::Value SendInput(const Napi::CallbackInfo& info);

    // Git operations
    Napi::Value GitStatus(const Napi::CallbackInfo& info);
    Napi::Value GitDiff(const Napi::CallbackInfo& info);
    Napi::Value GitBranch(const Napi::CallbackInfo& info);
    Napi::Value GitLog(const Napi::CallbackInfo& info);

    // Event logging
    Napi::Value AppendEventLog(const Napi::CallbackInfo& info);
    Napi::Value ReadEventLog(const Napi::CallbackInfo& info);

    std::map<std::string, std::shared_ptr<CodexSession>> sessions_;
    std::mutex sessions_mutex_;
};

// ─── CodexSession implementation ────────────────────────────────────────────

void CodexSession::start(const std::string& codex_path, const std::string& repo_path) {
    pid = spawn_process(codex_path, repo_path);
    if (pid > 0) {
        running.store(true);
        session_id = "sess_" + std::to_string(pid);
    }
}

void CodexSession::stop() {
    if (pid > 0) {
        ::kill(pid, SIGTERM);
        ::waitpid(pid, nullptr, WNOHANG);
    }
    stopped.store(true);
    running.store(false);
}

void CodexSession::send_input(const std::string& input) {
    // Write to the PTY's master side (handled by read thread's fd)
    // This is a placeholder — actual PTY write happens via the bridge
}

int CodexSession::spawn_process(const std::string& codex_path, const std::string& repo_path) {
    // Fork and exec Codex CLI
    pid_t child = ::fork();
    if (child == 0) {
        // Child process
        std::string cmd = codex_path + " -c \"model=remote_llamacpp\"";
        if (!repo_path.empty()) {
            cmd += " --repo " + repo_path;
        }

        // TODO: Set up PTY here (posix_openpt, grantpt, unlockpt, etc.)
        // For now, just exec with pipes
        execl("/bin/sh", "sh", "-c", cmd.c_str(), nullptr);
        _exit(127);
    } else if (child > 0) {
        return child;
    }
    return -1;
}

void CodexSession::parse_output_line(const std::string& line) {
    // Try to parse as JSON event first
    if (!line.empty() && line[0] == '{') {
        parse_json_line(line);
        return;
    }

    // Fallback: heuristic parsing of CLI output
    CodexEvent event;
    event.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
    event.session_id = session_id;

    if (line.find("prompt") != std::string::npos || line.find("user:") != std::string::npos) {
        event.type = "prompt";
    } else if (line.find("response") != std::string::npos || line.find("assistant:") != std::string::npos) {
        event.type = "response";
    } else if (line.find("tool_call") != std::string::npos || line.find("executing") != std::string::npos) {
        event.type = "tool_call";
    } else if (line.find("approval") != std::string::npos || line.find("approve") != std::string::npos) {
        event.type = "approval_request";
    } else {
        event.type = "output";
    }

    event.content = line;
    if (on_event) on_event(event);
}

void CodexSession::parse_json_line(const std::string& json_str) {
    // Simple JSON parser for structured events
    // In production, use a proper JSON library like nlohmann/json
    CodexEvent event;
    event.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
    event.session_id = session_id;

    // Extract type field
    auto type_pos = json_str.find("\"type\"");
    if (type_pos != std::string::npos) {
        auto colon_pos = json_str.find(':', type_pos);
        auto quote_start = json_str.find('"', colon_pos);
        auto quote_end = json_str.find('"', quote_start + 1);
        if (quote_start != std::string::npos && quote_end != std::string::npos) {
            event.type = json_str.substr(quote_start + 1, quote_end - quote_start - 1);
        }
    }

    // Extract content field
    auto content_pos = json_str.find("\"content\"");
    if (content_pos != std::string::npos) {
        auto colon_pos = json_str.find(':', content_pos);
        auto quote_start = json_str.find('"', colon_pos);
        auto quote_end = json_str.find('"', quote_start + 1);
        if (quote_start != std::string::npos && quote_end != std::string::npos) {
            event.content = json_str.substr(quote_start + 1, quote_end - quote_start - 1);
        }
    }

    if (!event.type.empty() && on_event) {
        on_event(event);
    }
}

// ─── Git implementation ─────────────────────────────────────────────────────

std::vector<GitStatusEntry> git_status(const std::string& repo_path) {
    std::vector<GitStatusEntry> entries;
    // Execute: git -C <repo> status --porcelain
    FILE* pipe = popen(("git -C \"" + repo_path + "\" status --porcelain 2>/dev/null").c_str(), "r");
    if (!pipe) return entries;

    char buffer[256];
    while (fgets(buffer, sizeof(buffer), pipe)) {
        std::string line(buffer);
        line.pop_back(); // remove newline
        if (line.length() >= 3) {
            GitStatusEntry entry;
            entry.x = line.substr(0, 1);
            entry.y = line.substr(1, 1);
            entry.path = line.substr(3);
            entries.push_back(entry);
        }
    }
    pclose(pipe);
    return entries;
}

std::string git_diff(const std::string& repo_path, const std::string& file_path) {
    FILE* pipe = popen(("git -C \"" + repo_path + "\" diff -- \"" + file_path + "\" 2>/dev/null").c_str(), "r");
    if (!pipe) return "";

    std::stringstream ss;
    char buffer[4096];
    while (fgets(buffer, sizeof(buffer), pipe)) {
        ss << buffer;
    }
    pclose(pipe);
    return ss.str();
}

std::string git_branch(const std::string& repo_path) {
    FILE* pipe = popen(("git -C \"" + repo_path + "\" branch --show-current 2>/dev/null").c_str(), "r");
    if (!pipe) return "";

    char buffer[256];
    if (fgets(buffer, sizeof(buffer), pipe)) {
        std::string result(buffer);
        result.pop_back();
        pclose(pipe);
        return result;
    }
    pclose(pipe);
    return "";
}

std::vector<std::string> git_log(const std::string& repo_path, int count) {
    std::vector<std::string> entries;
    FILE* pipe = popen(("git -C \"" + repo_path + "\" log --oneline -n " + std::to_string(count)).c_str(), "r");
    if (!pipe) return entries;

    char buffer[1024];
    while (fgets(buffer, sizeof(buffer), pipe)) {
        std::string line(buffer);
        line.pop_back();
        if (!line.empty()) entries.push_back(line);
    }
    pclose(pipe);
    return entries;
}

// ─── Event logging implementation ───────────────────────────────────────────

bool append_event_log(const std::string& file_path, const CodexEvent& event) {
    std::ofstream out(file_path, std::ios::app);
    if (!out.is_open()) return false;

    // Simple JSON serialization
    out << "{\"id\":\"" << event.id << "\","
        << "\"timestamp\":" << event.timestamp << ","
        << "\"type\":\"" << event.type << "\","
        << "\"content\":\"" << event.content << "\","
        << "\"session_id\":\"" << event.session_id << "\"}" << "\n";

    out.close();
    return true;
}

std::string read_event_log(const std::string& file_path) {
    std::ifstream in(file_path);
    if (!in.is_open()) return "";

    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

// ─── N-API implementation ───────────────────────────────────────────────────

Napi::Object CodexAddon::Init(Napi::Env env, Napi::Object exports) {
    auto addon = DefineClass(env, "codex", {
        InstanceMethod("startSession", &CodexAddon::StartSession),
        InstanceMethod("stopSession", &CodexAddon::StopSession),
        InstanceMethod("isSessionRunning", &CodexAddon::IsSessionRunning),
        InstanceMethod("sendInput", &CodexAddon::SendInput),
        InstanceMethod("gitStatus", &CodexAddon::GitStatus),
        InstanceMethod("gitDiff", &CodexAddon::GitDiff),
        InstanceMethod("gitBranch", &CodexAddon::GitBranch),
        InstanceMethod("gitLog", &CodexAddon::GitLog),
        InstanceMethod("appendEventLog", &CodexAddon::AppendEventLog),
        InstanceMethod("readEventLog", &CodexAddon::ReadEventLog),
    });

    exports.Set("codex", addon);
    return exports;
}

CodexAddon::CodexAddon(const Napi::CallbackInfo& info) : Napi::ObjectWrap<CodexAddon>(info) {}

Napi::Value CodexAddon::StartSession(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2) {
        throw Napi::Error::New(env, "Usage: startSession(id, {codexPath, repoPath})");
    }

    std::string id = info[0].As<Napi::String>().Utf8Value();
    Napi::Object opts = info[1].As<Napi::Object>();

    std::string codex_path = opts.Get("codexPath").As<Napi::String>().Utf8Value();
    std::string repo_path = opts.Has("repoPath") ? opts.Get("repoPath").As<Napi::String>().Utf8Value() : "";

    auto session = std::make_shared<CodexSession>();

    // Set up event callback
    session->on_event = [env, id](const CodexEvent& event) {
        // Emit event to JavaScript via N-API
        // This would typically use a persistent handle or queue mechanism
        (void)env; (void)id; (void)event;
        // TODO: Implement proper event emission to JS
    };

    session->start(codex_path, repo_path);

    {
        std::lock_guard<std::mutex> lock(sessions_mutex_);
        sessions_[id] = session;
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("sessionId", Napi::String::New(env, session->session_id));
    result.Set("pid", Napi::Number::New(env, static_cast<double>(session->pid)));
    return result;
}

Napi::Value CodexAddon::StopSession(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        throw Napi::Error::New(env, "Usage: stopSession(id)");
    }

    std::string id = info[0].As<Napi::String>().Utf8Value();

    std::lock_guard<std::mutex> lock(sessions_mutex_);
    auto it = sessions_.find(id);
    if (it != sessions_.end()) {
        it->second->stop();
        sessions_.erase(it);
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value CodexAddon::IsSessionRunning(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        throw Napi::Error::New(env, "Usage: isSessionRunning(id)");
    }

    std::string id = info[0].As<Napi::String>().Utf8Value();

    std::lock_guard<std::mutex> lock(sessions_mutex_);
    auto it = sessions_.find(id);
    bool running = (it != sessions_.end() && it->second->is_running());

    return Napi::Boolean::New(env, running);
}

Napi::Value CodexAddon::SendInput(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2) {
        throw Napi::Error::New(env, "Usage: sendInput(id, input)");
    }

    std::string id = info[0].As<Napi::String>().Utf8Value();
    std::string input = info[1].As<Napi::String>().Utf8Value();

    std::lock_guard<std::mutex> lock(sessions_mutex_);
    auto it = sessions_.find(id);
    if (it != sessions_.end()) {
        it->second->send_input(input);
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value CodexAddon::GitStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        throw Napi::Error::New(env, "Usage: gitStatus(repoPath)");
    }

    std::string repo_path = info[0].As<Napi::String>().Utf8Value();
    auto entries = git_status(repo_path);

    Napi::Array arr = Napi::Array::New(env, entries.size());
    for (size_t i = 0; i < entries.size(); i++) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("x", Napi::String::New(env, entries[i].x));
        obj.Set("y", Napi::String::New(env, entries[i].y));
        obj.Set("path", Napi::String::New(env, entries[i].path));
        arr.Set(i, obj);
    }

    return arr;
}

Napi::Value CodexAddon::GitDiff(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2) {
        throw Napi::Error::New(env, "Usage: gitDiff(repoPath, filePath)");
    }

    std::string repo_path = info[0].As<Napi::String>().Utf8Value();
    std::string file_path = info[1].As<Napi::String>().Utf8Value();
    auto diff = git_diff(repo_path, file_path);

    return Napi::String::New(env, diff);
}

Napi::Value CodexAddon::GitBranch(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        throw Napi::Error::New(env, "Usage: gitBranch(repoPath)");
    }

    std::string repo_path = info[0].As<Napi::String>().Utf8Value();
    auto branch = git_branch(repo_path);

    return Napi::String::New(env, branch);
}

Napi::Value CodexAddon::GitLog(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int count = 20;
    if (info.Length() >= 1) {
        count = info[0].As<Napi::Number>().Int32Value();
    }

    std::string repo_path = info[0].As<Napi::String>().Utf8Value();
    auto log_entries = git_log(repo_path, count);

    Napi::Array arr = Napi::Array::New(env, log_entries.size());
    for (size_t i = 0; i < log_entries.size(); i++) {
        arr.Set(i, Napi::String::New(env, log_entries[i]));
    }

    return arr;
}

Napi::Value CodexAddon::AppendEventLog(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2) {
        throw Napi::Error::New(env, "Usage: appendEventLog(filePath, eventJson)");
    }

    std::string file_path = info[0].As<Napi::String>().Utf8Value();
    std::string event_json = info[1].As<Napi::String>().Utf8Value();

    std::ofstream out(file_path, std::ios::app);
    if (out.is_open()) {
        out << event_json << "\n";
        out.close();
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value CodexAddon::ReadEventLog(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        throw Napi::Error::New(env, "Usage: readEventLog(filePath)");
    }

    std::string file_path = info[0].As<Napi::String>().Utf8Value();

    std::ifstream in(file_path);
    if (!in.is_open()) {
        return Napi::String::New(env, "");
    }

    std::stringstream ss;
    ss << in.rdbuf();
    return Napi::String::New(env, ss.str());
}

NODE_API_MODULE(codex, CodexAddon::Init)
