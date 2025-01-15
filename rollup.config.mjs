import typescript from 'rollup-plugin-typescript2';
import resolve from "@rollup/plugin-node-resolve";
import commonjs from '@rollup/plugin-commonjs';

const mode = process.env.MODE;
const isProd = mode === 'prod';

export default {
  input: `./languageserver/server.ts`,
  output: [
    // {
    //   file: './build/cjs/server.js',
    //   exports: 'named',
    //   format: 'cjs',
    //   sourcemap: !isProd
    // },
    {
      file: './out/languageserver.js',
      format: 'es',
      sourcemap: !isProd
    },
    // {
    //   file: 'build/server.global.js',
    //   name: 'DDBLS',
    //   format: 'iife',
    //   sourcemap: !isProd
    // },
  ],
  plugins: [resolve(), commonjs(), typescript({
    useTsconfigDeclarationDir: true,
    tsconfigOverride: {
      compilerOptions: {
        sourceMap: !isProd,
        "target": "es2020",
        "lib": ["es2021"],
        module: 'ESNext',
        "moduleResolution": "node",
        allowImportingTsExtensions: false,
        "sourceMap": true,
        "outDir": "out",
      },
      include: ['languageserver'],
      exclude: ["node_modules", "src", "./build.ts", "./builder.ts", "./dev.ts"]
    }
  }),],
  external: ['react']
};