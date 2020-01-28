{
  "targets": [
    {
      "target_name": "cppApiWrapper",
      "sources": [ "cppApiWrapper.cc" ],
      "include_dirs": [
        "<!(node -e \"require('nan')\")"
      ],
       "cflags_cc": [
        "-fexceptions",
        "-fPIC",
        "-D_GLIBCXX_USE_CXX11_ABI=0"
      ],
      "link_settings":{
        "libraries":["-Wl,-rpath,lib", "-llibDolphinDBAPI"],
        "library_dirs":["lib"]
      }
    }
  ]
}
