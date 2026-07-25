#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <vector>
#include <string>
#include <unordered_map>
#include <cmath>
#include <algorithm>

namespace py = pybind11;

class BM25Kernel {
public:
    BM25Kernel(double k1 = 1.5, double b = 0.75) : k1_(k1), b_(b), avgdl_(0.0) {}

    void rebuild(const std::vector<std::vector<std::string>>& doc_tokens) {
        tf_.clear();
        doc_lengths_.clear();
        idf_.clear();
        avgdl_ = 0.0;

        size_t num_docs = doc_tokens.size();
        if (num_docs == 0) return;

        tf_.resize(num_docs);
        doc_lengths_.resize(num_docs);

        std::unordered_map<std::string, size_t> doc_freqs;
        double total_length = 0.0;

        for (size_t i = 0; i < num_docs; ++i) {
            const auto& tokens = doc_tokens[i];
            doc_lengths_[i] = tokens.size();
            total_length += tokens.size();

            std::unordered_map<std::string, double>& doc_tf = tf_[i];
            for (const auto& token : tokens) {
                doc_tf[token] += 1.0;
            }

            for (const auto& pair : doc_tf) {
                doc_freqs[pair.first]++;
            }
        }

        avgdl_ = total_length / num_docs;

        for (const auto& pair : doc_freqs) {
            const std::string& term = pair.first;
            size_t df = pair.second;
            idf_[term] = std::log((num_docs - df + 0.5) / (df + 0.5) + 1.0);
        }
    }

    std::vector<std::pair<double, int>> search(const std::vector<std::string>& query_tokens, int top_k) {
        size_t num_docs = tf_.size();
        if (num_docs == 0 || query_tokens.empty()) return {};

        std::vector<std::pair<double, int>> scores;
        scores.reserve(num_docs);

        for (size_t i = 0; i < num_docs; ++i) {
            double score = 0.0;
            const auto& doc_tf = tf_[i];
            double doc_len = doc_lengths_[i];

            for (const auto& term : query_tokens) {
                auto idf_it = idf_.find(term);
                if (idf_it == idf_.end()) continue;

                auto tf_it = doc_tf.find(term);
                double tf_val = (tf_it != doc_tf.end()) ? tf_it->second : 0.0;

                if (tf_val > 0.0) {
                    double idf_val = idf_it->second;
                    double numerator = tf_val * (k1_ + 1.0);
                    double denominator = tf_val + k1_ * (1.0 - b_ + b_ * doc_len / avgdl_);
                    score += idf_val * (numerator / denominator);
                }
            }
            if (score > 0.0) {
                scores.push_back({score, static_cast<int>(i)});
            }
        }

        std::sort(scores.begin(), scores.end(), [](const auto& a, const auto& b) {
            if (std::abs(a.first - b.first) < 1e-9) {
                return a.second > b.second;
            }
            return a.first > b.first;
        });

        if (static_cast<int>(scores.size()) > top_k) {
            scores.resize(top_k);
        }

        return scores;
    }

private:
    double k1_;
    double b_;
    double avgdl_;
    std::vector<std::unordered_map<std::string, double>> tf_;
    std::vector<double> doc_lengths_;
    std::unordered_map<std::string, double> idf_;
};

PYBIND11_MODULE(bm25_extension, m) {
    py::class_<BM25Kernel>(m, "BM25Kernel")
        .def(py::init<double, double>(), py::arg("k1") = 1.5, py::arg("b") = 0.75)
        .def("rebuild", &BM25Kernel::rebuild)
        .def("search", &BM25Kernel::search);
}
