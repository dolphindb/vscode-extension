import typescript from 'rollup-plugin-typescript2';
import resolve from "@rollup/plugin-node-resolve";
import commonjs from '@rollup/plugin-commonjs';

const mode = process.env.MODE;
const isProd = mode === 'prod';

export default {
  input: `./src/server.ts`,
  output: [
    {
      file: './build/cjs/server.js',
      exports: 'named',
      format: 'cjs',
      sourcemap: !isProd
    },
    {
      file: './build/server.js',
      format: 'es',
      sourcemap: !isProd
    },
    {
      file: 'build/server.global.js',
      name: 'DDBLS',
      format: 'iife',
      sourcemap: !isProd
    },
  ],
  plugins: [resolve(),commonjs(),typescript({
    useTsconfigDeclarationDir: true,
    tsconfigOverride: {
      compilerOptions: {
        sourceMap: !isProd,
        declarationDir: 'build',
      }, include: ['src'],
    }
  }),],
  external:['react']
};