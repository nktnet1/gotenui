export const MAX_BASIC_USERNAME_LENGTH = 255
export const MAX_BASIC_PASSWORD_LENGTH = 2048
export const MAX_BEARER_TOKEN_LENGTH = 4096
// Basic credentials are encoded as UTF-8 before Base64. A UTF-16 code unit
// requires at most three bytes, and the username/password separator one byte.
export const MAX_BROWSER_AUTHORIZATION_LENGTH =
  6 + 4 * Math.ceil((3 * (MAX_BASIC_USERNAME_LENGTH + MAX_BASIC_PASSWORD_LENGTH) + 1) / 3)

function validBasicText(value: string): boolean {
  return (
    !/\p{Cs}/u.test(value) &&
    ![...value].some((char) => {
      const code = char.charCodeAt(0)
      return code < 32 || code === 127
    })
  )
}

export function isBasicUsername(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_BASIC_USERNAME_LENGTH &&
    !value.includes(':') &&
    validBasicText(value)
  )
}

export function isBasicPassword(value: string): boolean {
  return value.length > 0 && value.length <= MAX_BASIC_PASSWORD_LENGTH && validBasicText(value)
}

export function isBearerToken(value: string): boolean {
  return value.length <= MAX_BEARER_TOKEN_LENGTH && /^[A-Za-z0-9._~+/-]+=*$/.test(value)
}
