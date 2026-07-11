{
  "targets": [
    {
      "target_name": "codex",
      "sources": ["src/addon.cpp"],
      "include_dirs": [],
      "conditions": [
        ["OS=='linux'", {
          "cflags_cc": ["-std=c++17", "-fPIC"],
          "ldflags": []
        }],
        ["OS=='mac'", {
          "cflags_cc!": ["-fno-rtti", "-fno-exceptions"],
          "cflags_cc": ["-std=c++17", "-fPIC"],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          }
        }],
        ["OS=='win'", {
          "cflags_cc": ["/std:c++17"]
        }]
      ]
    }
  ]
}
