#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <vector>
#include <string>
#include <unordered_map>
#include <cmath>
#include <algorithm>
#ifdef _OPENMP
#include <omp.h>
#endif

namespace py = pybind11;

struct Posting {
    int doc_id;
    double tf;
};

class BM25Kernel {
public:
    BM25Kernel(double k1 = 1.5, double b = 0.75) : k1_(k1), b_(b), avgdl_(0.0) {}

    void rebuild(const std::vector<std::vector<std::string>>& doc_tokens) {
        inverted_index_.clear();
        doc_lengths_.clear();
        idf_.clear();
        avgdl_ = 0.0;

        size_t num_docs = doc_tokens.size();
        if (num_docs == 0) return;

        doc_lengths_.resize(num_docs);
        double total_length = 0.0;

        std::vector<std::unordered_map<std::string, double>> doc_tfs(num_docs);

#pragma omp parallel for reduction(+:total_length) schedule(static)
        for (int i = 0; i < static_cast<int>(num_docs); ++i) {
            const auto& tokens = doc_tokens[i];
            doc_lengths_[i] = tokens.size();
            total_length += tokens.size();

            auto& doc_tf = doc_tfs[i];
            for (const auto& token : tokens) {
                doc_tf[token] += 1.0;
            }
        }

        avgdl_ = total_length / num_docs;

        std::unordered_map<std::string, size_t> doc_freqs;
        for (int i = 0; i < static_cast<int>(num_docs); ++i) {
            for (const auto& pair : doc_tfs[i]) {
                const std::string& term = pair.first;
                double tf_val = pair.second;
                inverted_index_[term].push_back({i, tf_val});
                doc_freqs[term]++;
            }
        }

        for (const auto& pair : doc_freqs) {
            const std::string& term = pair.first;
            size_t df = pair.second;
            idf_[term] = std::log((num_docs - df + 0.5) / (df + 0.5) + 1.0);
        }
    }

    std::vector<std::pair<double, int>> search(const std::vector<std::string>& query_tokens, int top_k) const {
        size_t num_docs = doc_lengths_.size();
        if (num_docs == 0 || query_tokens.empty() || top_k <= 0) return {};

#ifdef _OPENMP
        int max_threads = omp_get_max_threads();
#else
        int max_threads = 1;
#endif

        std::unordered_map<std::string, double> unique_query_idfs;
        for (const auto& term : query_tokens) {
            auto idf_it = idf_.find(term);
            if (idf_it != idf_.end()) {
                unique_query_idfs[term] = idf_it->second;
            }
        }

        if (unique_query_idfs.empty()) return {};

        std::vector<std::vector<double>> thread_doc_scores(max_threads, std::vector<double>(num_docs, 0.0));
        std::vector<std::vector<int>> thread_touched_docs(max_threads);

        std::vector<std::pair<std::string, double>> term_list(unique_query_idfs.begin(), unique_query_idfs.end());
        int num_terms = static_cast<int>(term_list.size());

#pragma omp parallel
        {
#ifdef _OPENMP
            int tid = omp_get_thread_num();
#else
            int tid = 0;
#endif
            auto& local_scores = thread_doc_scores[tid];
            auto& local_touched = thread_touched_docs[tid];

#pragma omp for schedule(dynamic)
            for (int t = 0; t < num_terms; ++t) {
                const auto& term_pair = term_list[t];
                const std::string& term = term_pair.first;
                double idf_val = term_pair.second;

                auto inv_it = inverted_index_.find(term);
                if (inv_it == inverted_index_.end()) continue;

                for (const auto& posting : inv_it->second) {
                    int doc_id = posting.doc_id;
                    double tf_val = posting.tf;
                    double doc_len = doc_lengths_[doc_id];

                    double numerator = tf_val * (k1_ + 1.0);
                    double denominator = tf_val + k1_ * (1.0 - b_ + b_ * doc_len / avgdl_);
                    double term_score = idf_val * (numerator / denominator);

                    if (local_scores[doc_id] == 0.0) {
                        local_touched.push_back(doc_id);
                    }
                    local_scores[doc_id] += term_score;
                }
            }
        }

        std::vector<double> accumulated_scores(num_docs, 0.0);
        std::vector<int> candidate_docs;
        std::vector<bool> seen(num_docs, false);

        for (int t = 0; t < max_threads; ++t) {
            const auto& local_scores = thread_doc_scores[t];
            for (int doc_id : thread_touched_docs[t]) {
                accumulated_scores[doc_id] += local_scores[doc_id];
                if (!seen[doc_id]) {
                    seen[doc_id] = true;
                    candidate_docs.push_back(doc_id);
                }
            }
        }

        std::vector<std::pair<double, int>> scores;
        scores.reserve(candidate_docs.size());
        for (int doc_id : candidate_docs) {
            double s = accumulated_scores[doc_id];
            if (s > 0.0) {
                scores.push_back({s, doc_id});
            }
        }

        if (scores.empty()) return {};

        auto comp = [](const std::pair<double, int>& a, const std::pair<double, int>& b) {
            if (std::abs(a.first - b.first) < 1e-9) {
                return a.second > b.second;
            }
            return a.first > b.first;
        };

        if (static_cast<int>(scores.size()) > top_k) {
            std::partial_sort(scores.begin(), scores.begin() + top_k, scores.end(), comp);
            scores.resize(top_k);
        } else {
            std::sort(scores.begin(), scores.end(), comp);
        }

        return scores;
    }

private:
    double k1_;
    double b_;
    double avgdl_;
    std::unordered_map<std::string, std::vector<Posting>> inverted_index_;
    std::vector<double> doc_lengths_;
    std::unordered_map<std::string, double> idf_;
};

PYBIND11_MODULE(bm25_extension, m) {
    py::class_<BM25Kernel>(m, "BM25Kernel")
        .def(py::init<double, double>(), py::arg("k1") = 1.5, py::arg("b") = 0.75)
        .def("rebuild", &BM25Kernel::rebuild, py::call_guard<py::gil_scoped_release>())
        .def("search", &BM25Kernel::search, py::call_guard<py::gil_scoped_release>());
}
