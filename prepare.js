#!/usr/bin/env node

import { install } from 'husky'

if (process.env.username !== 'shf')
    install()
