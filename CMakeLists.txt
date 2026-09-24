cmake_minimum_required(VERSION 3.24)

project(denigma_online VERSION 1.0.0 LANGUAGES NONE)

# The WebAssembly module is Denigma's denigma_wasm target. This project selects
# where the module comes from (a prebuilt download, the pinned source, or a
# local checkout) and builds the static site from it.
if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "Denigma Online must be configured with Emscripten (use emcmake cmake ...).")
endif()

# The pin lives in these plain variables so that editing it here always takes
# effect. A cached DENIGMA_GIT_TAG would shadow the new value in an existing
# build tree, which is why overrides use separate cache entries instead.
set(DENIGMA_GIT_REPOSITORY_PIN "https://github.com/openmusx/denigma.git")
set(DENIGMA_GIT_TAG_PIN "5e15a50ed9efeebf5a2e6999b4a574bb8d5c6506")

set(DENIGMA_GIT_REPOSITORY_OVERRIDE "" CACHE STRING
    "Override the pinned Denigma repository")
set(DENIGMA_GIT_TAG_OVERRIDE "" CACHE STRING
    "Override the pinned Denigma commit, tag, or branch")
set(DENIGMA_SOURCE_DIR "" CACHE PATH "Optional local Denigma checkout")
option(DENIGMA_WASM_PREBUILT
    "Use the module Denigma's CI built for the pinned revision instead of building Denigma" ON)
set(DENIGMA_BUILD_JOBS 2 CACHE STRING "Parallel jobs for Denigma's own build")

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
endif()

find_program(NODE_EXECUTABLE node)
if(NOT NODE_EXECUTABLE)
    message(FATAL_ERROR "Node.js is required to build the static distribution")
endif()

# The module is staged here from whichever source is selected; the npm scripts
# and the site build read only this location.
set(DENIGMA_WASM_DIR "${CMAKE_BINARY_DIR}/wasm")
set(_denigma_wasm_stamp "${DENIGMA_WASM_DIR}/denigma-wasm.stamp")
set(_denigma_revision "${DENIGMA_GIT_REPOSITORY}@${DENIGMA_GIT_TAG}")
set(_denigma_wasm_prebuilt FALSE)

if(NOT DENIGMA_SOURCE_DIR AND DENIGMA_WASM_PREBUILT)
    # The stamp names the download and the revision it was for. A stamp for the
    # current revision is reused; otherwise the module is fetched from Denigma's
    # CI, and a source build is used when none is available.
    set(_denigma_wasm_origin "")
    if(EXISTS "${_denigma_wasm_stamp}"
            AND EXISTS "${DENIGMA_WASM_DIR}/denigma.js"
            AND EXISTS "${DENIGMA_WASM_DIR}/denigma.wasm")
        file(STRINGS "${_denigma_wasm_stamp}" _denigma_wasm_stamp_lines)
        list(GET _denigma_wasm_stamp_lines 0 _denigma_wasm_stamp_origin)
        list(GET _denigma_wasm_stamp_lines 1 _denigma_wasm_stamp_revision)
        if("${_denigma_wasm_stamp_revision}" STREQUAL "${_denigma_revision}")
            set(_denigma_wasm_origin "${_denigma_wasm_stamp_origin}")
        endif()
    endif()
    if(NOT _denigma_wasm_origin)
        execute_process(
            COMMAND "${NODE_EXECUTABLE}" "${CMAKE_SOURCE_DIR}/scripts/fetch-denigma-wasm.mjs"
                --repository "${DENIGMA_GIT_REPOSITORY}"
                --revision "${DENIGMA_GIT_TAG}"
                --output "${DENIGMA_WASM_DIR}"
            WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
            RESULT_VARIABLE _denigma_fetch_result
            OUTPUT_VARIABLE _denigma_fetch_output
            ERROR_VARIABLE _denigma_fetch_error
            OUTPUT_STRIP_TRAILING_WHITESPACE
            ERROR_STRIP_TRAILING_WHITESPACE
        )
        if(_denigma_fetch_result EQUAL 0)
            message(STATUS "${_denigma_fetch_output}")
            file(STRINGS "${_denigma_wasm_stamp}" _denigma_wasm_stamp_lines)
            list(GET _denigma_wasm_stamp_lines 0 _denigma_wasm_origin)
        else()
            message(STATUS "${_denigma_fetch_error}; building Denigma from source")
        endif()
    endif()
    if(_denigma_wasm_origin)
        set(_denigma_wasm_prebuilt TRUE)
        message(STATUS "Denigma WebAssembly module: prebuilt ${_denigma_wasm_origin} for ${DENIGMA_GIT_TAG}")
    endif()
endif()

if(NOT _denigma_wasm_prebuilt)
    include(ExternalProject)

    # Denigma is configured as its own top-level project with the arguments its
    # README documents for the WebAssembly build, plus the toolchain of this
    # configure.
    set(_denigma_cmake_args
        "-DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}"
        -DCMAKE_BUILD_TYPE=MinSizeRel
        -DDENIGMA_CXX_STANDARD=20
    )
    if(CMAKE_CROSSCOMPILING_EMULATOR)
        list(APPEND _denigma_cmake_args "-DCMAKE_CROSSCOMPILING_EMULATOR=${CMAKE_CROSSCOMPILING_EMULATOR}")
    endif()

    if(DENIGMA_SOURCE_DIR)
        # A local checkout builds in its own build-wasm directory, the one
        # Denigma's README uses. Only ExternalProject's bookkeeping lives here.
        set(_denigma_prefix "${CMAKE_BINARY_DIR}/denigma-local")
        set(_denigma_binary_dir "${DENIGMA_SOURCE_DIR}/build-wasm")
        set(_denigma_source_args SOURCE_DIR "${DENIGMA_SOURCE_DIR}" BUILD_ALWAYS TRUE)
        # An already configured directory keeps its generator.
        if(EXISTS "${_denigma_binary_dir}/CMakeCache.txt")
            file(STRINGS "${_denigma_binary_dir}/CMakeCache.txt" _denigma_generator
                REGEX "^CMAKE_GENERATOR:INTERNAL=")
            string(REGEX REPLACE "^CMAKE_GENERATOR:INTERNAL=" "" _denigma_generator "${_denigma_generator}")
            if(_denigma_generator)
                list(APPEND _denigma_source_args CMAKE_GENERATOR "${_denigma_generator}")
            endif()
        endif()
        message(STATUS "Denigma WebAssembly module: built from local checkout ${DENIGMA_SOURCE_DIR}")
    else()
        set(_denigma_prefix "${CMAKE_BINARY_DIR}/denigma-pinned")
        set(_denigma_binary_dir "${_denigma_prefix}/build")
        set(_denigma_source_args
            GIT_REPOSITORY "${DENIGMA_GIT_REPOSITORY}"
            GIT_TAG "${DENIGMA_GIT_TAG}"
            GIT_SHALLOW FALSE
            UPDATE_DISCONNECTED TRUE
        )
        # With UPDATE_DISCONNECTED the clone is never updated in place; a changed
        # pin discards the clone and its step stamps. The build directory, with
        # Denigma's fetched dependencies, is kept.
        if(DEFINED DENIGMA_POPULATED_REVISION
                AND NOT "${DENIGMA_POPULATED_REVISION}" STREQUAL "${_denigma_revision}")
            message(STATUS "Denigma revision changed to ${DENIGMA_GIT_TAG}; re-fetching")
            file(REMOVE_RECURSE "${_denigma_prefix}/src")
        endif()
        # The revision the clone was made from.
        set(DENIGMA_POPULATED_REVISION "${_denigma_revision}" CACHE INTERNAL
            "Denigma revision cloned into the pinned build tree")
        message(STATUS "Denigma WebAssembly module: built from pinned source ${DENIGMA_GIT_TAG}")
    endif()

    ExternalProject_Add(denigma
        PREFIX "${_denigma_prefix}"
        BINARY_DIR "${_denigma_binary_dir}"
        ${_denigma_source_args}
        CMAKE_ARGS ${_denigma_cmake_args}
        BUILD_COMMAND "${CMAKE_COMMAND}" --build <BINARY_DIR> --target denigma_wasm --parallel ${DENIGMA_BUILD_JOBS}
        BUILD_BYPRODUCTS
            "${_denigma_binary_dir}/wasm/denigma.js"
            "${_denigma_binary_dir}/wasm/denigma.wasm"
        INSTALL_COMMAND ""
        USES_TERMINAL_CONFIGURE TRUE
        USES_TERMINAL_BUILD TRUE
    )
    add_custom_command(
        OUTPUT "${DENIGMA_WASM_DIR}/denigma.js" "${DENIGMA_WASM_DIR}/denigma.wasm"
        COMMAND "${CMAKE_COMMAND}" -E make_directory "${DENIGMA_WASM_DIR}"
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${_denigma_binary_dir}/wasm/denigma.js"
            "${_denigma_binary_dir}/wasm/denigma.wasm"
            "${DENIGMA_WASM_DIR}"
        DEPENDS denigma
            "${_denigma_binary_dir}/wasm/denigma.js"
            "${_denigma_binary_dir}/wasm/denigma.wasm"
        COMMENT "Staging the Denigma WebAssembly module"
        VERBATIM
    )
    # The staged module is now a source build, not the recorded download.
    file(REMOVE "${_denigma_wasm_stamp}")
endif()

add_custom_target(web_dist ALL
    COMMAND "${NODE_EXECUTABLE}" "${CMAKE_SOURCE_DIR}/scripts/build-web.mjs"
        "${DENIGMA_WASM_DIR}/denigma.js"
        "${DENIGMA_WASM_DIR}/denigma.wasm"
    DEPENDS "${DENIGMA_WASM_DIR}/denigma.js" "${DENIGMA_WASM_DIR}/denigma.wasm"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    COMMENT "Building content-hashed static site"
    VERBATIM
)
