cmake_minimum_required(VERSION 3.24)

project(denigma_online VERSION 1.0.0 LANGUAGES CXX)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "Denigma Online must be configured with Emscripten (use emcmake cmake ...).")
endif()

include(FetchContent)

# Emscripten requires exception support at both compile and link time. CMake's
# language flags are used for every C++ compile and compiler-driver link,
# including FetchContent dependencies that establish independent directories.
string(APPEND CMAKE_CXX_FLAGS " -fexceptions")

set(DENIGMA_GIT_REPOSITORY "https://github.com/rpatters1/denigma.git" CACHE STRING
    "Denigma repository used by FetchContent")
set(DENIGMA_GIT_TAG "7e95231eb7ad7972ae56325a804fa21ff7db03ce" CACHE STRING
    "Pinned Denigma commit, tag, or branch")
set(DENIGMA_SOURCE_DIR "" CACHE PATH "Optional local Denigma checkout")

if(DENIGMA_SOURCE_DIR)
    get_filename_component(DENIGMA_SOURCE_DIR "${DENIGMA_SOURCE_DIR}" ABSOLUTE)
    if(NOT EXISTS "${DENIGMA_SOURCE_DIR}/CMakeLists.txt")
        message(FATAL_ERROR "DENIGMA_SOURCE_DIR is not a Denigma checkout: ${DENIGMA_SOURCE_DIR}")
    endif()
    set(FETCHCONTENT_SOURCE_DIR_DENIGMA "${DENIGMA_SOURCE_DIR}" CACHE PATH "Local Denigma source" FORCE)
endif()

set(denigma_BUILD_TESTING OFF CACHE BOOL "Do not build Denigma tests" FORCE)
set(denigma_BUILD_DOCS OFF CACHE BOOL "Do not build Denigma docs" FORCE)
set(DENIGMA_CXX_STANDARD 20 CACHE STRING "Use Denigma's minimum supported C++ standard" FORCE)

FetchContent_Declare(
    denigma
    GIT_REPOSITORY "${DENIGMA_GIT_REPOSITORY}"
    GIT_TAG "${DENIGMA_GIT_TAG}"
    GIT_SHALLOW FALSE
)
FetchContent_MakeAvailable(denigma)

file(STRINGS "${denigma_SOURCE_DIR}/CMakeLists.txt" _denigma_project_line
    REGEX "^project\\(denigma VERSION [0-9]+\\.[0-9]+\\.[0-9]+\\)")
if(NOT _denigma_project_line MATCHES "VERSION ([0-9]+\\.[0-9]+\\.[0-9]+)")
    message(FATAL_ERROR "Unable to determine the Denigma version")
endif()
set(DENIGMA_ONLINE_DENIGMA_VERSION "${CMAKE_MATCH_1}")

add_executable(denigma_online src/wasm/denigma_online.cpp)
target_compile_features(denigma_online PRIVATE cxx_std_20)
target_include_directories(denigma_online PRIVATE "${denigma_SOURCE_DIR}/src")
target_compile_definitions(denigma_online PRIVATE
    DENIGMA_NAME="denigma"
    DENIGMA_VERSION="${DENIGMA_ONLINE_DENIGMA_VERSION}"
)
target_link_libraries(denigma_online PRIVATE
    denigma::enigmaxml
    denigma::mnx
    denigma::musicxml
)

set_target_properties(denigma_online PROPERTIES
    OUTPUT_NAME denigma
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/wasm"
)

target_compile_options(denigma_online PRIVATE -Oz -Wall -Wextra -Wpedantic -Werror)
target_link_options(denigma_online PRIVATE
    -Oz
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sENVIRONMENT=web,worker,node"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sFILESYSTEM=0"
    "-sASSERTIONS=0"
    "-sEXPORTED_FUNCTIONS=['_denigma_malloc','_denigma_free','_denigma_inspect','_denigma_convert','_denigma_result_destroy','_denigma_result_success','_denigma_result_diagnostic_count','_denigma_result_diagnostic_severity','_denigma_result_diagnostic_message','_denigma_result_score_name','_denigma_result_score_page_width_mm','_denigma_result_score_page_height_mm','_denigma_result_score_spatium_mm','_denigma_result_score_has_page_margins','_denigma_result_score_page_margin_top_sp','_denigma_result_score_page_margin_bottom_sp','_denigma_result_score_page_margin_left_sp','_denigma_result_score_page_margin_right_sp','_denigma_result_part_count','_denigma_result_part_id','_denigma_result_part_name','_denigma_result_part_output_index','_denigma_result_part_page_width_mm','_denigma_result_part_page_height_mm','_denigma_result_part_spatium_mm','_denigma_result_part_has_page_margins','_denigma_result_part_page_margin_top_sp','_denigma_result_part_page_margin_bottom_sp','_denigma_result_part_page_margin_left_sp','_denigma_result_part_page_margin_right_sp','_denigma_result_output_count','_denigma_result_output_name','_denigma_result_output_data','_denigma_result_output_size','_denigma_result_output_index','_denigma_version','_denigma_commit']"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPU8','UTF8ToString']"
)

find_program(NODE_EXECUTABLE node)
if(NOT NODE_EXECUTABLE)
    message(FATAL_ERROR "Node.js is required to build the static distribution")
endif()
add_custom_target(web_dist ALL
    COMMAND "${NODE_EXECUTABLE}" "${CMAKE_SOURCE_DIR}/scripts/build-web.mjs"
        "${CMAKE_BINARY_DIR}/wasm/denigma.js"
        "${CMAKE_BINARY_DIR}/wasm/denigma.wasm"
    DEPENDS denigma_online
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Building content-hashed static site"
    VERBATIM
)
