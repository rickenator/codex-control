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

// ─── Event types ────────────────────────────────────────────────────────────

struct CodexEvent {
    std::string id;
    uint64_t timestamp;
    std::string type;
    napi_value payload; // serialized JSON
};

// ─── Process supervisor ─────────────────────────────────────────────────────

class ProcessHandle {
public:
    pid_t pid = -1;
    std::string command;
    std::string working_dir;
    std::atomic<bool> running{false};
    std::atomic<bool> stopped{false};

    // Output callbacks (called from PTY read thread)
    std::function<void(const std::string& stdout_data)> on_stdout;
    std::function<void(const std::string& stderr_data)> on_stderr;
    std::function<int(int signal)> on_exit;

    void start(const std::string& cmd, const std::string& cwd);
    void stop(int signal = SIGTERM);
    bool is_running() const { return running.load(); }
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

// ─── N-API bindings ─────────────────────────────────────────────────────────

class CodexAddon : public Napi::ObjectWrap<CodexAddon> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    CodexAddon(const Napi::CallbackInfo& info);

private:
    // Process management
    Napi::Value StartProcess(const Napi::CallbackInfo& info);
    Napi::Value StopProcess(const Napi::CallbackInfo& info);
    Napi::Value IsProcessRunning(const Napi::CallbackInfo& info);

    // Git operations
    Napi::Value GitStatus(const Napi::CallbackInfo& info);
    Napi::Value GitDiff(const Napi::CallbackInfo& info);
    Napi::Value GitBranch(const Napi::CallbackInfo& info);
    Napi::Value GitLog(const Napi::CallbackInfo& info);

    // Event logging
    Napi::Value AppendEventLog(const Napi::CallbackInfo& info);
    Napi::Value ReadEventLog(const Napi::CallbackInfo& info);

    std::map<std::string, std::shared_ptr<ProcessHandle>> processes_;
    std::mutex processes_mutex_;
};

// ─── Process implementation ─────────────────────────────────────────────────

void ProcessHandle::start(const std::string& cmd, const std::string& cwd) {
    // Use node-pty for PTY management (spawned from JS layer)
    // This is a placeholder — actual PTY spawn happens in the JS bridge
    command = cmd;
    working_dir = cwd;
    running.store(true);
}

void ProcessHandle::stop(int signal) {
    if (pid > 0) {
        ::kill(pid, signal);
    }
    stopped.store(true);
    running.store(false);
}

// ─── Git implementation ─────────────────────────────────────────────────────

std::vector<GitStatusEntry> git_status(const std::string& repo_path) {
    std::vector<GitStatusEntry> entries;
    // Execute: git -C <repo> status --porcelain
    // Parse output lines like " M src/main.cpp"
    // TODO: implement proper parsing with error handling
    return entries;
}

std::string git_diff(const std::string& repo_path, const std::string& file_path) {
    // Execute: git -C <repo> diff -- <file>
    // Return unified diff as string
    // TODO: implement proper execution with error handling
    return "";
}

std::string git_branch(const std::string& repo_path) {
    // Execute: git -C <repo> branch --show-current
    // TODO: implement
    return "";
}

std::vector<std::string> git_log(const std::string& repo_path, int count) {
    // Execute: git -C <repo> log --oneline -n <count>
    // TODO: implement
    return {};
}

// ─── N-API implementation ───────────────────────────────────────────────────

Napi::Object CodexAddon::Init(Napi::Env env, Napi::Object exports) {
    auto addon = DefineClass(env, "codex", {
        InstanceMethod("startProcess", &CodexAddon::StartProcess),
        InstanceMethod("stopProcess", &CodexAddon::StopProcess),
        InstanceMethod("isProcessRunning", &CodexAddon::IsProcessRunning),
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

Napi::Value CodexAddon::StartProcess(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2) {
        throw Napi::Error::New(env, "Usage: startProcess(id, {command, cwd})");
    }

    std::string id = info[0].As<Napi::String>().Utf8Value();
    Napi::Object opts = info[1].As<Napi::Object>();

    std::string command = opts.Get("command").As<Napi::String>().Utf8Value();
    std::string cwd = opts.Has("cwd") ? opts.Get("cwd").As<Napi::String>().Utf8Value() : ".";

    auto handle = std::make_shared<ProcessHandle>();
    handle->start(command, cwd);

    {
        std::lock_guard<std::mutex> lock(processes_mutex_);
        processes_[id] = handle;
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value CodexAddon::StopProcess(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        throw Napi::Error::New(env, "Usage: stopProcess(id)");
    }

    std::string id = info[0].As<Napi::String>().Utf8Value();

    std::lock_guard<std::mutex> lock(processes_mutex_);
    auto it = processes_.find(id);
    if (it != processes_.end()) {
        it->second->stop(SIGTERM);
        processes_.erase(it);
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value CodexAddon::IsProcessRunning(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        throw Napi::Error::New(env, "Usage: isProcessRunning(id)");
    }

    std::string id = info[0].As<Napi::String>().Utf8Value();

    std::lock_guard<std::mutex> lock(processes_mutex_);
    auto it = processes_.find(id);
    bool running = (it != processes_.end() && it->second->is_running());

    return Napi::Boolean::New(env, running);
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
