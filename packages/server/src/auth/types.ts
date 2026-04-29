export interface JwtClaims {
  sub: string
  name?: string
  vaults: string[]
  exp?: number
  iat?: number
  iss?: string
  aud?: string | string[]
}

export interface AuthenticatedRequest {
  vaultId: string
  userId: string
  userName: string
  claims: JwtClaims
}

export interface AccordConnectionContext {
  vaultId?: string
  userId?: string
  userName?: string
  claims?: JwtClaims
}
