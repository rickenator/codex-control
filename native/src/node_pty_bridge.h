#pragma once
// Bridge between C++ process supervisor and node-pty JS bindings.
// The JS layer spawns the PTY via node-pty; this C++ code manages
// lifecycle, signal forwarding, and output buffering.

#include <string>
#include <functional>
#include <atomic>

class PtyBridge {
public:
    using StdoutCallback = std::function<void(const char*, size_t)>;
    using StderrCallback = std::function<void(const char*, size_t)>;
    using ExitCallback = std::function<void(int exit_code)>;

    PtyBridge(StdoutCallback on_stdout, StderrCallback on_stderr, ExitCallback on_exit);
    ~PtyBridge();

    void attach(int pty_fd);
    void write(const char* data, size_t len);
    void resize(int rows, int cols);
    void send_signal(int signal);
    bool is_alive() const;

private:
    StdoutCallback on_stdout_;
    StderrCallback on_stderr_;
    ExitCallback on_exit_;
    std::atomic<bool> alive_{false};
    int pty_fd_ = -1;
};
