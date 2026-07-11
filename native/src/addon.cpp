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
#include <map>
#include <sys/ioctl.h>

// ─── Event types ────────────────────────────────────────────────────────────

struct CodexEvent {
    std::string id;
    uint64_t timestamp;
    std::string type;       // "prompt", "response", "tool_call", "approval_request", "diff", "error", "output"
    std::string content;
    std::string session_id;
};

// ─── Codex CLI adapter with PTY support ─────────────────────────────────────

class CodexSession {
public:
    pid_t pid = -1;
    int pty_fd = -1;          // Master fd of the PTY
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

    CodexSession() = default;
    ~CodexSession();

    void start(const std::string& codex_path, const std::string& repo_path);
    void stop();
    bool is_running() const { return running.load(); }
    void send_input(const std::string& input);
    void resize(int rows, int cols);

private:
    // Create a PTY and fork the child process
    int create_pty_and_fork(const std::string& codex_path, const std::string& repo_path);
    // Read thread function — reads from PTY master fd
    void read_thread_func();
    // Parse a line of Codex output into events
    void parse_output_line(const std::string& line);
    // Parse JSON-lines structured output
    void parse_json_line(const std::string& json_str);
};

CodexSession::~CodexSession() {
    if (pty_fd >= 0) {
        ::close(pty_fd);
        pty_fd = -1;
    }
}

void CodexSession::start(const std::string& codex_path, const std::string& repo_path) {
    pty_fd = create_pty_and_fork(codex_path, repo_path);
    if (pty_fd >= 0) {
        running.store(true);
        session_id = "sess_" + std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count());

        // Start the read thread
        std::thread(&CodexSession::read_thread_func, this).detach();
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
    if (pty_fd >= 0 && !input.empty()) {
        // Write to PTY master — add newline for shell-like behavior
        std::string data = input + "\n";
        ::write(pty_fd, data.c_str(), data.size());
    }
}

void CodexSession::resize(int rows, int cols) {
    if (pty_fd >= 0) {
        struct winsize ws{};
        ws.ws_row = static_cast<unsigned short>(rows);
        ws.ws_col = static_cast<unsigned short>(cols);
        ::ioctl(pty_fd, TIOCSWINSZ, &ws);
    }
}

int CodexSession::create_pty_and_fork(const std::string& codex_path, const std::string& repo_path) {
    // Open a pseudo-terminal
    int master = ::posix_openpt(O_RDWR | O_NOCTTY);
    if (master < 0) {
        return -1;
    }

    if (::grantpt(master) != 0 || ::unlockpt(master) != 0) {
        ::close(master);
        return -1;
    }

    char* slave_name = ::ptsname(master);
    if (!slave_name) {
        ::close(master);
        return -1;
    }

    // Fork
    pid_t child = ::fork();
    if (child == 0) {
        // Child process
        ::close(master);

        // Open slave side and become session leader
        int slave = ::open(slave_name, O_RDWR);
        if (slave < 0) _exit(127);

        ::dup2(slave, STDIN_FILENO);
        ::dup2(slave, STDOUT_FILENO);
        ::dup2(slave, STDERR_FILENO);
        if (slave > 2) ::close(slave);

        ::setsid();

        // Set environment
        if (!repo_path.empty()) {
            setenv("CODEX_REPO", repo_path.c_str(), 1);
        }

        // Execute Codex CLI
        execl(codex_path.c_str(), "codex", "-c", "model=remote_llamacpp", nullptr);

        // If codex_path is not just "codex", try with full path
        execl("/usr/local/bin/codex", "codex", "-c", "model=remote_llamacpp", nullptr);
        _exit(127);
    } else if (child > 0) {
        pid = child;
        return master;
    }

    ::close(master);
    return -1;
}

void CodexSession::read_thread_func() {
    char buf[65536];
    std::string line_buffer;

    while (running.load() && !stopped.load()) {
        ssize_t n = ::read(pty_fd, buf, sizeof(buf));
        if (n > 0) {
            // Process the raw bytes
            for (ssize_t i = 0; i < n; i++) {
                char c = buf[i];

                // Skip control characters (except newline)
                if (c != '\n' && (c < 0x20 || c > 0x7E)) continue;

                if (c == '\n') {
                    if (!line_buffer.empty()) {
                        parse_output_line(line_buffer);
                        line_buffer.clear();
                    }
                } else {
                    line_buffer += c;
                }
            }
        } else if (n == 0) {
            // EOF — process exited
            running.store(false);
            stopped.store(true);
            if (on_exit) on_exit(0, "");
            break;
        }
    }
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
        std::chrono::system_clock::now().time_since_epoch()).count();
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
    CodexEvent event;
    event.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
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
    Napi::Value ResizePty(const Napi::CallbackInfo& info);

    // Git operations
    Napi::Value GitStatus(const Napi::CallbackInfo& info);
    Napi::Value GitDiff(const Napi::CallbackInfo& info);
    Napi::Value GitBranch(const Napi::CallbackInfo& info);
    Napi::Value GitLog(const Napi::CallbackInfo& info);
    Napi::Value GitDiffHunks(const Napi::CallbackInfo& info);
    Napi::Value GitApplyHunk(const Napi::CallbackInfo& info);
    Napi::Value GitRejectHunk(const Napi::CallbackInfo& info);

    // Event logging
    Napi::Value AppendEventLog(const Napi::CallbackInfo& info);
    Napi::Value ReadEventLog(const Napi::CallbackInfo& info);

    std::map<std::string, std::shared_ptr<CodexSession>> sessions_;
    std::mutex sessions_mutex_;
};

// ─── Git implementation ─────────────────────────────────────────────────────

std::vector<GitStatusEntry> git_status(const std::string& repo_path) {
    std::vector<GitStatusEntry> entries;
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
        InstanceMethod("resizePty", &CodexAddon::ResizePty),
        InstanceMethod("gitStatus", &CodexAddon::GitStatus),
        InstanceMethod("gitDiff", &CodexAddon::GitDiff),
        InstanceMethod("gitBranch", &CodexAddon::GitBranch),
        InstanceMethod("gitDiffHunks", &CodexAddon::GitDiffHunks),
        InstanceMethod("gitApplyHunk", &CodexAddon::GitApplyHunk),
        InstanceMethod("gitRejectHunk", &CodexAddon::GitRejectHunk),
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

    // Set up event callback — emit to JS via N-API
    session->on_event = [env, id](const CodexEvent& event) {
        // This would typically use a persistent handle or queue mechanism
        // For now, we'll emit via the main process IPC layer
        (void)env; (void)id; (void)event;
    };

    session->start(codex_path, repo_path);

    {
        std::lock_guard<std::mutex> lock(sessions_mutex_);
        sessions_[id] = session;
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("sessionId", Napi::String::New(env, session->session_id));
    result.Set("pid", Napi::Number::New(env, static_cast<double>(session->pid)));
    result.Set("ptyFd", Napi::Number::New(env, static_cast<double>(session->pty_fd)));
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

Napi::Value CodexAddon::ResizePty(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3) {
        throw Napi::Error::New(env, "Usage: resizePty(id, rows, cols)");
    }

    std::string id = info[0].As<Napi::String>().Utf8Value();
    int rows = info[1].As<Napi::Number>().Int32Value();
    int cols = info[2].As<Napi::Number>().Int32Value();

    std::lock_guard<std::mutex> lock(sessions_mutex_);
    auto it = sessions_.find(id);
    if (it != sessions_.end()) {
        it->second->resize(rows, cols);
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


// ─── Hunk-based diff operations ─────────────────────────────────────────────

struct GitHunk {
    int id;
    int old_start;
    int old_count;
    int new_start;
    int new_count;
    std::string header;  // @@ -old_start,old_count +new_start,new_count @@
    std::string content; // hunk body (lines starting with +, -, or space)
};

std::vector<GitHunk> git_diff_hunks(const std::string& repo_path, const std::string& file_path) {
    std::vector<GitHunk> hunks;
    
    // Get the full diff
    FILE* pipe = popen(("git -C \"" + repo_path + "\" diff -- \"" + file_path + "\" 2>/dev/null").c_str(), "r");
    if (!pipe) return hunks;
    
    std::string full_diff;
    char buffer[4096];
    while (fgets(buffer, sizeof(buffer), pipe)) {
        full_diff += buffer;
    }
    pclose(pipe);
    
    if (full_diff.empty()) return hunks;
    
    // Parse unified diff into hunks
    std::istringstream stream(full_diff);
    std::string line;
    GitHunk current_hunk;
    int hunk_id = 0;
    
    while (std::getline(stream, line)) {
        // Check for hunk header: @@ -old_start,old_count +new_start,new_count @@
        if (line.find("@@") == 0 && line.length() > 4) {
            // Save previous hunk if exists
            if (!current_hunk.content.empty()) {
                hunks.push_back(current_hunk);
                hunk_id++;
            }
            
            // Start new hunk
            current_hunk.id = hunk_id;
            current_hunk.header = line;
            current_hunk.content.clear();
            
            // Parse @@ -old_start,old_count +new_start,new_count @@
            size_t first_at = line.find("@@");
            size_t second_at = line.find("@@", first_at + 2);
            if (second_at != std::string::npos) {
                std::string range = line.substr(first_at + 2, second_at - first_at - 2);
                // Parse old range: -start,count or -start
                size_t comma = range.find(',');
                if (comma != std::string::npos) {
                    current_hunk.old_start = std::stoi(range.substr(1, comma - 1));
                    current_hunk.old_count = std::stoi(range.substr(comma + 1));
                } else {
                    current_hunk.old_start = std::stoi(range.substr(1));
                    current_hunk.old_count = 1;
                }
                
                // Parse new range: +start,count or +start
                std::string new_range = range.substr(comma + 1);
                comma = new_range.find(',');
                if (comma != std::string::npos) {
                    current_hunk.new_start = std::stoi(new_range.substr(1, comma - 1));
                    current_hunk.new_count = std::stoi(new_range.substr(comma + 1));
                } else {
                    current_hunk.new_start = std::stoi(new_range.substr(1));
                    current_hunk.new_count = 1;
                }
            }
        } else if (!current_hunk.header.empty()) {
            // Hunk body line (starts with +, -, or space)
            if (!line.empty() && (line[0] == '+' || line[0] == '-' || line[0] == ' ')) {
                current_hunk.content += line + "\n";
            }
        }
    }
    
    // Don't forget the last hunk
    if (!current_hunk.content.empty()) {
        hunks.push_back(current_hunk);
    }
    
    return hunks;
}

std::string git_apply_hunk(const std::string& repo_path, const std::string& file_path, int hunk_id) {
    // Extract the specific hunk and apply it
    FILE* pipe = popen(("git -C \"" + repo_path + "\" diff -- \"" + file_path + "\" 2>/dev/null").c_str(), "r");
    if (!pipe) return "Error: failed to get diff";
    
    std::string full_diff;
    char buffer[4096];
    while (fgets(buffer, sizeof(buffer), pipe)) {
        full_diff += buffer;
    }
    pclose(pipe);
    
    // Parse and extract only the target hunk
    std::istringstream stream(full_diff);
    std::string line;
    int current_id = 0;
    bool found = false;
    std::string selected_hunk;
    
    while (std::getline(stream, line)) {
        if (line.find("@@") == 0 && line.length() > 4) {
            if (current_id == hunk_id) {
                found = true;
                selected_hunk += line + "\n";
            }
            current_id++;
        } else if (found && !line.empty() && (line[0] == '+' || line[0] == '-' || line[0] == ' ')) {
            selected_hunk += line + "\n";
        } else if (found && !line.empty() && line[0] != '+' && line[0] != '-' && line[0] != ' ') {
            // Next hunk or diff header, stop
            break;
        }
    }
    
    if (!found) return "Error: hunk not found";
    
    // Write to temp file and apply
    std::string tmp_path = repo_path + "/.consiglio-hunk-" + std::to_string(hunk_id) + ".patch";
    std::ofstream out(tmp_path);
    if (!out.is_open()) return "Error: cannot write patch file";
    out << selected_hunk;
    out.close();
    
    // Apply the patch
    FILE* apply_pipe = popen(("git -C \"" + repo_path + "\" apply -- \"" + tmp_path + "\" 2>&1").c_str(), "r");
    if (!apply_pipe) {
        unlink(tmp_path.c_str());
        return "Error: failed to apply hunk";
    }
    
    std::string result;
    while (fgets(buffer, sizeof(buffer), apply_pipe)) {
        result += buffer;
    }
    pclose(apply_pipe);
    
    // Clean up temp file
    unlink(tmp_path.c_str());
    
    if (!result.empty()) return "Error: " + result;
    return "OK";
}

std::string git_reject_hunk(const std::string& repo_path, const std::string& file_path, int hunk_id) {
    // Get current file content, remove the rejected hunk's additions
    FILE* pipe = popen(("git -C \"" + repo_path + "\" diff -- \"" + file_path + "\" 2>/dev/null").c_str(), "r");
    if (!pipe) return "Error: failed to get diff";
    
    std::string full_diff;
    char buffer[4096];
    while (fgets(buffer, sizeof(buffer), pipe)) {
        full_diff += buffer;
    }
    pclose(pipe);
    
    // Parse and create a patch that REJECTS the target hunk (inverts it)
    std::istringstream stream(full_diff);
    std::string line;
    int current_id = 0;
    bool in_target = false;
    std::string inverted_hunk;
    
    while (std::getline(stream, line)) {
        if (line.find("@@") == 0 && line.length() > 4) {
            if (current_id == hunk_id) {
                in_target = true;
                // Invert the hunk header: swap old and new ranges
                size_t first_at = line.find("@@");
                size_t second_at = line.find("@@", first_at + 2);
                if (second_at != std::string::npos) {
                    std::string range = line.substr(first_at + 2, second_at - first_at - 2);
                    inverted_hunk = "@@ " + range + " @@";
                } else {
                    inverted_hunk = line;
                }
            } else if (current_id != hunk_id) {
                // Skip non-target hunks entirely
            }
            current_id++;
        } else if (in_target && !line.empty() && (line[0] == '+' || line[0] == '-' || line[0] == ' ')) {
            // Invert: + becomes -, - becomes +, space stays space
            char inverted = line[0];
            if (line[0] == '+') inverted = '-';
            else if (line[0] == '-') inverted = '+';
            
            // For context lines (space), keep them but mark the removed lines
            if (line[0] == ' ') {
                inverted_hunk += " " + line.substr(1) + "\n";
            } else {
                inverted_hunk += inverted + line.substr(1) + "\n";
            }
        } else if (in_target && !line.empty() && line[0] != '+' && line[0] != '-' && line[0] != ' ') {
            // Next section, stop
            break;
        }
    }
    
    if (inverted_hunk.empty()) return "Error: hunk not found";
    
    // Write inverted patch and apply it
    std::string tmp_path = repo_path + "/.consiglio-reject-" + std::to_string(hunk_id) + ".patch";
    std::ofstream out(tmp_path);
    if (!out.is_open()) return "Error: cannot write patch file";
    out << inverted_hunk;
    out.close();
    
    // Apply the inverted patch
    FILE* apply_pipe = popen(("git -C \"" + repo_path + "\" apply -- \"" + tmp_path + "\" 2>&1").c_str(), "r");
    if (!apply_pipe) {
        unlink(tmp_path.c_str());
        return "Error: failed to reject hunk";
    }
    
    std::string result;
    while (fgets(buffer, sizeof(buffer), apply_pipe)) {
        result += buffer;
    }
    pclose(apply_pipe);
    
    unlink(tmp_path.c_str());
    
    if (!result.empty()) return "Error: " + result;
    return "OK";
}

// ─── N-API bindings for hunk operations ─────────────────────────────────────

Napi::Value CodexAddon::GitDiffHunks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2) {
        throw Napi::Error::New(env, "Usage: gitDiffHunks(repoPath, filePath)");
    }

    std::string repo_path = info[0].As<Napi::String>().Utf8Value();
    std::string file_path = info[1].As<Napi::String>().Utf8Value();
    auto hunks = git_diff_hunks(repo_path, file_path);

    Napi::Array arr = Napi::Array::New(env, hunks.size());
    for (size_t i = 0; i < hunks.size(); i++) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("id", Napi::Number::New(env, static_cast<double>(hunks[i].id)));
        obj.Set("oldStart", Napi::Number::New(env, static_cast<double>(hunks[i].old_start)));
        obj.Set("oldCount", Napi::Number::New(env, static_cast<double>(hunks[i].old_count)));
        obj.Set("newStart", Napi::Number::New(env, static_cast<double>(hunks[i].new_start)));
        obj.Set("newCount", Napi::Number::New(env, static_cast<double>(hunks[i].new_count)));
        obj.Set("header", Napi::String::New(env, hunks[i].header));
        obj.Set("content", Napi::String::New(env, hunks[i].content));
        arr.Set(i, obj);
    }

    return arr;
}

Napi::Value CodexAddon::GitApplyHunk(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3) {
        throw Napi::Error::New(env, "Usage: gitApplyHunk(repoPath, filePath, hunkId)");
    }

    std::string repo_path = info[0].As<Napi::String>().Utf8Value();
    std::string file_path = info[1].As<Napi::String>().Utf8Value();
    int hunk_id = info[2].As<Napi::Number>().Int32Value();

    auto result = git_apply_hunk(repo_path, file_path, hunk_id);
    return Napi::String::New(env, result);
}

Napi::Value CodexAddon::GitRejectHunk(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3) {
        throw Napi::Error::New(env, "Usage: gitRejectHunk(repoPath, filePath, hunkId)");
    }

    std::string repo_path = info[0].As<Napi::String>().Utf8Value();
    std::string file_path = info[1].As<Napi::String>().Utf8Value();
    int hunk_id = info[2].As<Napi::Number>().Int32Value();

    auto result = git_reject_hunk(repo_path, file_path, hunk_id);
    return Napi::String::New(env, result);
}
