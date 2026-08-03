#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <string>
#include <string_view>
#include <vector>
#include <regex>
#ifdef _OPENMP
#include <omp.h>
#endif

namespace py = pybind11;

class MarkdownCleaner {
public:
    static std::string clean_chunk(const std::string& text) {
        if (text.empty()) return "";

        // Remove code blocks
        static const std::regex code_block_regex(R"(```[\s\S]*?```)");
        std::string result = std::regex_replace(text, code_block_regex, "");

        // Remove images
        static const std::regex image_regex(R"(!\[.*?\]\(.*?\))");
        result = std::regex_replace(result, image_regex, "");

        // Simplify links: [text](url) -> text
        static const std::regex link_regex(R"(\[(.*?)\]\([^)]+\))");
        result = std::regex_replace(result, link_regex, "$1");

        // Remove alert tags
        static const std::regex alert_regex(R"(\[\!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\])", std::regex_constants::icase);
        result = std::regex_replace(result, alert_regex, "");

        // Trim
        size_t start = result.find_first_not_of(" \t\n\r");
        if (start == std::string::npos) return "";
        size_t end = result.find_last_not_of(" \t\n\r");
        return result.substr(start, end - start + 1);
    }

    static std::vector<std::string> clean_chunks_parallel(const std::vector<std::string>& chunks) {
        size_t n = chunks.size();
        std::vector<std::string> cleaned(n);

#pragma omp parallel for schedule(static)
        for (int i = 0; i < static_cast<int>(n); ++i) {
            cleaned[i] = clean_chunk(chunks[i]);
        }

        return cleaned;
    }
};

PYBIND11_MODULE(markdown_extension, m) {
    m.def("clean_chunk", &MarkdownCleaner::clean_chunk, py::call_guard<py::gil_scoped_release>());
    m.def("clean_chunks_parallel", &MarkdownCleaner::clean_chunks_parallel, py::call_guard<py::gil_scoped_release>());
}
