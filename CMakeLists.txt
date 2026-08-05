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

# The pin lives in these plain variables so that editing it here always takes
# effect. A cached DENIGMA_GIT_TAG would shadow the new value in an existing
# build tree, which is why overrides use separate cache entries instead.
set(DENIGMA_GIT_REPOSITORY_PIN "https://github.com/rpatters1/denigma.git")
set(DENIGMA_GIT_TAG_PIN "bfae0dfbb18427f4316032629dba72daf2aefab0")

set(DENIGMA_GIT_REPOSITORY_OVERRIDE "" CACHE STRING
    "Override the pinned Denigma repository")
set(DENIGMA_GIT_TAG_OVERRIDE "" CACHE STRING
    "Override the pinned Denigma commit, tag, or branch")
set(DENIGMA_SOURCE_DIR "" CACHE PATH "Optional local Denigma checkout")

foreach(_denigma_pin GIT_REPOSITORY GIT_TAG)
    if(DEFINED CACHE{DENIGMA_${_denigma_pin}})
        # Left over from a build tree configured before the pin moved out of the
        # cache, or passed with -D. Either way it no longer selects the revision.
        message(WARNING "DENIGMA_${_denigma_pin} is no longer read from the cache; "
            "use DENIGMA_${_denigma_pin}_OVERRIDE instead")
        unset(DENIGMA_${_denigma_pin} CACHE)
    endif()
    if(DENIGMA_${_denigma_pin}_OVERRIDE)
        set(DENIGMA_${_denigma_pin} "${DENIGMA_${_denigma_pin}_OVERRIDE}")
    else()
        set(DENIGMA_${_denigma_pin} "${DENIGMA_${_denigma_pin}_PIN}")
    endif()
endforeach()

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

# FetchContent skips its populate step once the dependency has been downloaded, so
# a changed revision only takes effect if the download and update stamps are
# discarded first. A local checkout is never fetched, so it is left alone.
set(_denigma_revision "${DENIGMA_GIT_REPOSITORY}@${DENIGMA_GIT_TAG}")
if(NOT DENIGMA_SOURCE_DIR
        AND DEFINED DENIGMA_POPULATED_REVISION
        AND NOT "${DENIGMA_POPULATED_REVISION}" STREQUAL "${_denigma_revision}")
    message(STATUS "Denigma revision changed to ${DENIGMA_GIT_TAG}; re-fetching")
    set(_denigma_subbuild "${FETCHCONTENT_BASE_DIR}/denigma-subbuild")
    file(GLOB_RECURSE _denigma_stamps
        "${_denigma_subbuild}/denigma-populate-done"
        "${_denigma_subbuild}/denigma-populate-update"
        "${_denigma_subbuild}/denigma-populate-download"
        "${_denigma_subbuild}/denigma-populate-gitclone-lastrun.txt"
    )
    if(_denigma_stamps)
        file(REMOVE ${_denigma_stamps})
    else()
        # No stamps to invalidate (for example after a partial clean); drop the
        # source tree so the clone step runs from scratch.
        file(REMOVE_RECURSE "${FETCHCONTENT_BASE_DIR}/denigma-src")
    endif()
    unset(_denigma_stamps)
    unset(_denigma_subbuild)
endif()

FetchContent_Declare(
    denigma
    GIT_REPOSITORY "${DENIGMA_GIT_REPOSITORY}"
    GIT_TAG "${DENIGMA_GIT_TAG}"
    GIT_SHALLOW FALSE
)
FetchContent_MakeAvailable(denigma)

if(DENIGMA_SOURCE_DIR)
    # Record the local checkout so that switching back to a fetched Denigma
    # re-fetches rather than reusing a source tree of unknown revision.
    set(_denigma_revision "local:${DENIGMA_SOURCE_DIR}")
endif()
set(DENIGMA_POPULATED_REVISION "${_denigma_revision}" CACHE INTERNAL
    "Denigma source that populated this build tree")

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
