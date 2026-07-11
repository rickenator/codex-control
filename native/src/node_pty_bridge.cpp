#include "node_pty_bridge.h"
#include <unistd.h>
#include <fcntl.h>
#include <termios.h>
#include <sys/ioctl.h>
#include <poll.h>
#include <thread>
#include <atomic>

static const size_t READ_BUF_SIZE = 65536;

PtyBridge::PtyBridge(StdoutCallback on_stdout, StderrCallback on_stderr, ExitCallback on_exit)
    : on_stdout_(std::move(on_stdout)),
      on_stderr_(std::move(on_stderr)),
      on_exit_(std::move(on_exit)) {}

PtyBridge::~PtyBridge() {
    if (pty_fd_ >= 0) {
        ::close(pty_fd_);
        pty_fd_ = -1;
    }
}

void PtyBridge::attach(int pty_fd) {
    pty_fd_ = pty_fd;
    alive_.store(true);

    // Start background read thread
    std::thread([this]() {
        char buf[READ_BUF_SIZE];
        while (alive_.load()) {
            pollfd pfd{};
            pfd.fd = pty_fd_;
            pfd.events = POLLIN;
            int ret = poll(&pfd, 1, 500); // 500ms timeout

            if (ret > 0 && (pfd.revents & POLLIN)) {
                ssize_t n = ::read(pty_fd_, buf, sizeof(buf));
                if (n > 0) {
                    on_stdout_(buf, static_cast<size_t>(n));
                } else if (n == 0) {
                    // EOF — process exited
                    alive_.store(false);
                    on_exit_(0);
                    break;
                }
            }

            if (pfd.revents & (POLLERR | POLLHUP)) {
                alive_.store(false);
                on_exit_(-1);
                break;
            }
        }
    }).detach();
}

void PtyBridge::write(const char* data, size_t len) {
    if (pty_fd_ >= 0) {
        ::write(pty_fd_, data, len);
    }
}

void PtyBridge::resize(int rows, int cols) {
    if (pty_fd_ >= 0) {
        struct winsize ws{};
        ws.ws_row = static_cast<unsigned short>(rows);
        ws.ws_col = static_cast<unsigned short>(cols);
        ::ioctl(pty_fd_, TIOCSWINSZ, &ws);
    }
}

void PtyBridge::send_signal(int signal) {
    // Forward signal to the PTY's foreground process group
    if (pty_fd_ >= 0) {
        ::kill(-pty_fd_, signal); // negative PID = process group
    }
}

bool PtyBridge::is_alive() const {
    return alive_.load();
}
