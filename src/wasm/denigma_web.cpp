// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <memory>
#include <new>
#include <optional>
#include <set>
#include <span>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "denigma/formats/enigmaxml.h"
#include "denigma/formats/mnx.h"
#include "denigma/formats/musicxml.h"
#include "denigma/io/random_access_reader.h"
#include "core/denigma.h"
#include "core/musx_reader.h"
#include "formats/enigmaxml/enigmaxml.h"

namespace {

struct OutputFile
{
    std::string name;
    std::vector<std::uint8_t> data;
};

struct PartInfo
{
    int id{};
    std::string name;
    int outputIndex{};
    int partOrder{};
};

struct WebResult
{
    bool success{ true };
    std::vector<denigma::Diagnostic> diagnostics;
    std::vector<PartInfo> parts;
    std::vector<OutputFile> outputs;
};

void addDiagnostic(WebResult& result, denigma::MessageSeverity severity, std::string message)
{
    result.success = result.success && severity != denigma::MessageSeverity::Error;
    result.diagnostics.push_back({ severity, std::move(message) });
}

denigma::CommonOptions makeCommonOptions(WebResult& result, const char* sourceName)
{
    denigma::CommonOptions options;
    options.sourceName = sourceName ? sourceName : "browser.musx";
    options.logCallback = [&result](denigma::MessageSeverity severity, std::string_view message) {
        addDiagnostic(result, severity, std::string(message));
    };
    return options;
}

std::span<const std::byte> inputBytes(const std::uint8_t* data, std::size_t size)
{
    if (!data && size != 0) {
        throw std::invalid_argument("Input buffer is null.");
    }
    return { reinterpret_cast<const std::byte*>(data), size };
}

void appendOutput(WebResult& result, std::string_view name, std::span<const std::byte> data)
{
    OutputFile output;
    output.name = name;
    output.data.resize(data.size());
    std::transform(data.begin(), data.end(), output.data.begin(), [](std::byte value) {
        return static_cast<std::uint8_t>(value);
    });
    result.outputs.push_back(std::move(output));
}

void appendOutput(WebResult& result, std::string name, const std::string& data)
{
    OutputFile output;
    output.name = std::move(name);
    output.data.assign(data.begin(), data.end());
    result.outputs.push_back(std::move(output));
}

void finishConversion(WebResult& result, const denigma::ConversionResult& conversionResult)
{
    if (conversionResult.hasError()) {
        result.success = false;
    }
    if (result.outputs.empty() && result.success) {
        addDiagnostic(result, denigma::MessageSeverity::Error, "Conversion produced no output.");
    } else if (result.success && std::any_of(result.outputs.begin(), result.outputs.end(), [](const OutputFile& output) {
        return output.data.empty();
    })) {
        addDiagnostic(result, denigma::MessageSeverity::Error, "Conversion produced an empty output file.");
    }
}

void inspectMusx(WebResult& result, std::span<const std::byte> bytes, const char* sourceName)
{
    denigma::BufferRandomAccessReader reader(bytes);
    denigma::DenigmaContext context(DENIGMA_NAME);
    context.inputFilePath = sourceName ? sourceName : "browser.musx";
    context.logCallback = [&result](denigma::MessageSeverity severity, std::string_view message) {
        addDiagnostic(result, severity, std::string(message));
    };

    auto input = denigma::formats::enigmaxml::detail::extractMusxInputData(reader, context);
    auto document = denigma::createMusxDocument<denigma::MusxReader>(input, context);
    auto parts = document->getOthers()->getArray<musx::dom::others::PartDefinition>(musx::dom::SCORE_PARTID);

    int outputIndex = 1; // MusicXML callback zero is the score.
    for (const auto& part : parts) {
        if (part->isScore()) {
            continue;
        }
        auto name = part->getName(musx::util::EnigmaString::AccidentalStyle::Unicode);
        if (name.empty()) {
            name = "Part " + std::to_string(part->getCmper());
        }
        result.parts.push_back({ part->getCmper(), std::move(name), outputIndex++, part->partOrder });
    }
    std::stable_sort(result.parts.begin(), result.parts.end(), [](const PartInfo& lhs, const PartInfo& rhs) {
        return lhs.partOrder < rhs.partOrder;
    });
}

void convertMusicXml(WebResult& result,
                     const denigma::BufferRandomAccessReader& reader,
                     const char* sourceName,
                     bool includeTempo,
                     int cueLayer,
                     const int* selectedOutputs,
                     std::size_t selectedCount)
{
    denigma::formats::musicxml::Options options;
    options.common = makeCommonOptions(result, sourceName);
    options.includeTempoTool = includeTempo;
    options.allPartsAndScore = true;
    if (cueLayer > 0) {
        options.cueLayer = cueLayer;
    }

    const std::set<int> selected(selectedOutputs, selectedOutputs + selectedCount);
    int outputIndex = 0;
    denigma::formats::musicxml::MusxToMusicXmlMultiOutputConverter converter;
    const auto conversionResult = converter.convert(reader,
        [&](std::string_view suggestedName, std::span<const std::byte> data) {
            if (selected.contains(outputIndex)) {
                appendOutput(result, suggestedName, data);
            }
            ++outputIndex;
        }, options);
    finishConversion(result, conversionResult);
}

void convertMnx(WebResult& result,
                const denigma::BufferRandomAccessReader& reader,
                const char* sourceName,
                bool includeTempo,
                bool splitInstruments,
                int indentSpaces,
                int cueLayer)
{
    denigma::formats::mnx::Options options;
    options.common = makeCommonOptions(result, sourceName);
    options.includeTempoTool = includeTempo;
    options.splitInstruments = splitInstruments;
    options.indentSpaces = indentSpaces < 0 ? std::nullopt : std::optional<int>(indentSpaces);
    if (cueLayer > 0) {
        options.cueLayer = cueLayer;
    }

    std::ostringstream output;
    denigma::formats::mnx::MusxToMnxJsonConverter converter;
    const auto conversionResult = converter.convert(reader, output, options);
    if (!conversionResult.hasError()) {
        appendOutput(result, {}, output.str());
    }
    finishConversion(result, conversionResult);
}

void convertEnigmaXml(WebResult& result,
                      const denigma::BufferRandomAccessReader& reader,
                      const char* sourceName)
{
    denigma::formats::enigmaxml::Options options;
    options.common = makeCommonOptions(result, sourceName);
    std::ostringstream output;
    denigma::formats::enigmaxml::MusxToEnigmaXmlConverter converter;
    const auto conversionResult = converter.convert(reader, output, options);
    if (!conversionResult.hasError()) {
        appendOutput(result, {}, output.str());
    }
    finishConversion(result, conversionResult);
}

template <typename Callback>
WebResult* makeResult(Callback&& callback)
{
    auto result = std::make_unique<WebResult>();
    try {
        callback(*result);
    } catch (const std::exception& ex) {
        addDiagnostic(*result, denigma::MessageSeverity::Error, ex.what());
    } catch (...) {
        addDiagnostic(*result, denigma::MessageSeverity::Error, "Unknown Denigma error.");
    }
    return result.release();
}

template <typename Collection>
const typename Collection::value_type* itemAt(const Collection& collection, std::size_t index)
{
    return index < collection.size() ? &collection[index] : nullptr;
}

} // namespace

extern "C" {

void* denigma_malloc(std::size_t size) { return ::operator new(size, std::nothrow); }
void denigma_free(void* pointer) { ::operator delete(pointer); }

WebResult* denigma_inspect(const std::uint8_t* data, std::size_t size, const char* sourceName)
{
    return makeResult([&](WebResult& result) { inspectMusx(result, inputBytes(data, size), sourceName); });
}

WebResult* denigma_convert(const std::uint8_t* data,
                           std::size_t size,
                           const char* sourceName,
                           int format,
                           int includeTempo,
                           int splitInstruments,
                           int indentSpaces,
                           int cueLayer,
                           const int* selectedOutputs,
                           std::size_t selectedCount)
{
    return makeResult([&](WebResult& result) {
        const auto bytes = inputBytes(data, size);
        denigma::BufferRandomAccessReader reader(bytes);
        switch (format) {
        case 0:
            if (!selectedOutputs || selectedCount == 0) {
                throw std::invalid_argument("Select the score or at least one linked part.");
            }
            convertMusicXml(result, reader, sourceName, includeTempo != 0, cueLayer, selectedOutputs, selectedCount);
            break;
        case 1:
            convertMnx(result, reader, sourceName, includeTempo != 0, splitInstruments != 0, indentSpaces, cueLayer);
            break;
        case 2:
            convertEnigmaXml(result, reader, sourceName);
            break;
        default:
            throw std::invalid_argument("Unknown output format.");
        }
    });
}

void denigma_result_destroy(WebResult* result) { delete result; }
int denigma_result_success(const WebResult* result) { return result && result->success ? 1 : 0; }

std::size_t denigma_result_diagnostic_count(const WebResult* result)
{
    return result ? result->diagnostics.size() : 0;
}

int denigma_result_diagnostic_severity(const WebResult* result, std::size_t index)
{
    const auto* item = result ? itemAt(result->diagnostics, index) : nullptr;
    return item ? static_cast<int>(item->severity) : static_cast<int>(denigma::MessageSeverity::Error);
}

const char* denigma_result_diagnostic_message(const WebResult* result, std::size_t index)
{
    const auto* item = result ? itemAt(result->diagnostics, index) : nullptr;
    return item ? item->message.c_str() : "";
}

std::size_t denigma_result_part_count(const WebResult* result) { return result ? result->parts.size() : 0; }

int denigma_result_part_id(const WebResult* result, std::size_t index)
{
    const auto* item = result ? itemAt(result->parts, index) : nullptr;
    return item ? item->id : 0;
}

const char* denigma_result_part_name(const WebResult* result, std::size_t index)
{
    const auto* item = result ? itemAt(result->parts, index) : nullptr;
    return item ? item->name.c_str() : "";
}

int denigma_result_part_output_index(const WebResult* result, std::size_t index)
{
    const auto* item = result ? itemAt(result->parts, index) : nullptr;
    return item ? item->outputIndex : -1;
}

std::size_t denigma_result_output_count(const WebResult* result) { return result ? result->outputs.size() : 0; }

const char* denigma_result_output_name(const WebResult* result, std::size_t index)
{
    const auto* item = result ? itemAt(result->outputs, index) : nullptr;
    return item ? item->name.c_str() : "";
}

const std::uint8_t* denigma_result_output_data(const WebResult* result, std::size_t index)
{
    const auto* item = result ? itemAt(result->outputs, index) : nullptr;
    return item && !item->data.empty() ? item->data.data() : nullptr;
}

std::size_t denigma_result_output_size(const WebResult* result, std::size_t index)
{
    const auto* item = result ? itemAt(result->outputs, index) : nullptr;
    return item ? item->data.size() : 0;
}

const char* denigma_version() { return DENIGMA_VERSION; }
const char* denigma_commit() { return denigma::gitCommit(); }

} // extern "C"
