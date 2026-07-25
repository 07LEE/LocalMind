import os
from setuptools import setup, Extension
from setuptools.command.build_ext import build_ext
import sys

class Pybind11Extension(Extension):
    def __init__(self, name, sources, **kwargs):
        super().__init__(name, sources, **kwargs)

class BuildExt(build_ext):
    def build_extensions(self):
        import pybind11
        for ext in self.extensions:
            ext.include_dirs.append(pybind11.get_include())
            if sys.platform == "win32":
                ext.extra_compile_args = ["/O2", "/std:c++17"]
            else:
                ext.extra_compile_args = ["-O3", "-std=c++17", "-fPIC"]
        super().build_extensions()

setup(
    name="bm25_extension",
    ext_modules=[
        Pybind11Extension(
            "bm25_extension",
            sources=[os.path.join(os.path.dirname(__file__), "bm25_kernel.cpp")],
        )
    ],
    cmdclass={"build_ext": BuildExt},
    zip_safe=False,
)
