import process from 'process'

import {
    I18N,
    type Language,
} from 'xshell/i18n'

import _dict from './dict.json'

const { locale } = JSON.parse(
    process.env.VSCODE_NLS_CONFIG || '{ "locale": "zh" }'
)

// LOCAL
// const i18n = new I18N(_dict, 'en')
const i18n = new I18N(_dict, locale.slice(0, 2) as Language)

const { t, r, language } = i18n

export { i18n, t, r, language }
