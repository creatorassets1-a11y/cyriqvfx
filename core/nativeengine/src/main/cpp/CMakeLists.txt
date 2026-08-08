cmake_minimum_required(VERSION 3.22.1)
project(apexengine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The portable core. Deliberately no Android, GL or JNI headers, so the same
# sources build for the host and their numerics are unit-testable without a
# device — see ADR 0006.
add_library(apex_core STATIC
    apex/matte/chroma_key.cpp
)
target_include_directories(apex_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

target_compile_options(apex_core PRIVATE
    -Wall -Wextra -Wpedantic
    # Frame work is throughput-bound; -O3 and fast relaxed float are worth it
    # here in a way they would not be in the document layer.
    $<$<CONFIG:Release>:-O3 -ffast-math>
)

# The JNI surface. Kept to its own translation unit so the core stays free of
# Android headers and can be reasoned about — and tested — on its own.
add_library(apexengine SHARED
    jni/apex_jni.cpp
)
target_link_libraries(apexengine PRIVATE apex_core log)

if(ANDROID_ABI STREQUAL "arm64-v8a")
    # NEON is baseline on arm64, so the intrinsic paths need no runtime guard.
    target_compile_definitions(apex_core PUBLIC APEX_HAS_NEON=1)
endif()
