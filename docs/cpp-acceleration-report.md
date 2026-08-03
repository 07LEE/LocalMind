# C++ BM25 Acceleration Performance Report

This report documents the architectural improvements and performance gains achieved by integrating native C++ and pybind11 acceleration into the LocalMind project.

## Architectural Improvements

- C++ Core Kernel: The performance-critical TF-IDF computations and BM25 ranking loops are refactored from PyTorch tensors into native C++ STL-based structures (`bm25_kernel.cpp`).
- Pybind11 Integration: Bound the compiled C++ kernel as a Python extension (`bm25_extension`) to enable zero-overhead interoperability.
- Dual-Backend Compatibility: The Python layer (`sparse.py`) automatically attempts to import the compiled C++ module, gracefully falling back to PyTorch tensor operations if the native binary is not found.
- Correctness Alignment: Implemented specialized tie-breaker sorting matching Python's native `argsort` to ensure 1-to-1 equivalence of scores.

## Performance Benchmark Results

| Module | PyTorch Backend (Fallback) | C++ Accelerated Engine | Speedup Ratio |
| :--- | :--- | :--- | :--- |
| Indexing (Rebuild) | 0.7584s | 0.6552s | 1.16x |
| BM25 Keyword Search | 13.68ms | 0.12ms | 113.72x |

*Note: Benchmarks were executed using 20 distinct Korean queries against a document database containing 280 documents (1,208 text chunks).*

## Summary of Benefits

- Zero Tensor Overhead: Completely removes the CPU/GPU memory allocation and data transfer latency caused by PyTorch tensor operations.
- Microsecond Latency: Achieves a search time of 0.12 ms (microsecond scale), enabling ultra-low latency queries suitable for highly concurrent RAG and web visualization backends.
- Fallback Stability: Built-in dynamic imports ensure stable execution on target machines lacking compiled binaries by falling back to the standard Python/PyTorch framework.
