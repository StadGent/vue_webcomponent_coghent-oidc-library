import { App, ref, reactive, Ref, inject, watch, WatchStopHandle } from "vue"
import { Router, NavigationGuardNext } from "vue-router"

const loginRedirectRouteKey = "oidc-login-redirect-route"

export interface OpenIdConnectConfiguration {
  baseUrl: string
  tokenEndpoint: string
  authEndpoint: string
  logoutEndpoint: string
  clientId: string
  clientSecret?: string
  scope?: string
  // Properties needed for doing token call on backend server (more secure and keeps clientSecret out of frontend config)
  serverBaseUrl?: string
  serverTokenEndpoint?: string
  serverRefreshEndpoint?: string
  internalRedirectUrl?: string
  apiCodeEndpoint?: string
  redirectUri: string
  kcIdpHint: string | "no-hint"
}
const defaultConfig: OpenIdConnectConfiguration = {
  baseUrl: "",
  serverBaseUrl: undefined,
  tokenEndpoint: "token",
  authEndpoint: "auth",
  logoutEndpoint: "logout",
  clientId: "",
  serverTokenEndpoint: "token/",
  serverRefreshEndpoint: "refresh/",
  internalRedirectUrl: "",
  apiCodeEndpoint: "/api/auth_code",
  redirectUri: "",
  kcIdpHint: "no-hint",
}

export interface OpenIdConnectUserInformation {
  name: string
  preferred_username: string
  given_name: string
  family_name: string
  email: string
}

export const DefaultOIDC: unique symbol = Symbol("Auth")
export const useAuth = () => inject<OpenIdConnectClient>(DefaultOIDC)!

export class OpenIdConnectClient {
  isAuthenticated: Ref<boolean>
  loading: Ref<boolean>
  error: any
  config: OpenIdConnectConfiguration
  user: string | null

  constructor(config: Partial<OpenIdConnectConfiguration>) {
    this.isAuthenticated = ref(false)
    this.loading = ref(false)
    this.error = undefined
    this.config = reactive({ ...defaultConfig, ...config })
    this.user = null
  }

  install(app: App) {
    app.provide(DefaultOIDC, this)
  }

  async changeRedirectRoute(route: string) {
    this.config.redirectUri = route
  }

  async processAuthCode(authCode: string, router: Router) {
    this.loading.value = true
    try {
      await this.sendReceivedCode(authCode)
      await this.verifyServerAuth()
      const storedRedirectRoute = this.config.redirectUri
      sessionStorage.removeItem(loginRedirectRouteKey)
      router.push({
        path: storedRedirectRoute,
      })
    } catch (e) {
      this.isAuthenticated.value = false
      this.error = e
    }
    this.loading.value = false
  }

  async verifyServerAuth() {
    this.loading.value = true
    try {
      const response = await fetch("/api/me", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      })
      if (response) {
        this.user = await response.json()
        if (response.status)
          this.isAuthenticated.value = response.status !== 401
      }
    } catch (e) {
      this.isAuthenticated.value = false
      this.user = null
      this.error = e
    }
    this.loading.value = false
  }

  async sendReceivedCode(authCode: string) {
    const {
      apiCodeEndpoint,
      baseUrl,
      clientId,
      tokenEndpoint,
      internalRedirectUrl,
    } = this.config
    await fetch(`${apiCodeEndpoint}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        realm: baseUrl,
        authCode,
        clientId,
        tokenEndpoint,
        redirectUri: this.config.redirectUri,
      }),
    })
  }

  redirectToLogin(finalRedirectRoute?: string) {
    if (finalRedirectRoute) {
      sessionStorage.setItem(loginRedirectRouteKey, finalRedirectRoute)
    }
    const { authEndpoint, baseUrl, clientId, internalRedirectUrl, scope } =
      this.config

    let params = new URLSearchParams({
      scope: scope || "openid",
      client_id: clientId,
      response_type: "code",
      redirect_uri: this.config.redirectUri,
    })
    if (this.config.kcIdpHint === "no-hint") {
      params = new URLSearchParams({
        scope: scope || "openid",
        client_id: clientId,
        response_type: "code",
        redirect_uri: this.config.redirectUri,
        kc_idp_hint: this.config.kcIdpHint,
      })
    }
    window.location.href = `${baseUrl}${authEndpoint}?${params}`
  }

  async assertIsAuthenticated(
    dest: string,
    cb: NavigationGuardNext
  ): Promise<void> {
    await waitTillFalse(this.loading)
    if (this.isAuthenticated.value) {
      this.verifyServerAuth()
      return cb()
    }
    await this.verifyServerAuth()
    await waitTillFalse(this.loading)
    if (this.isAuthenticated.value) {
      return cb()
    }
    this.redirectToLogin(dest)
    return cb(false)
  }

  resetAuthProperties() {
    this.isAuthenticated.value = false
    this.user = null
  }
}

async function waitTillFalse(x: Ref<unknown>): Promise<void> {
  return new Promise((resolve, _reject) => {
    if (!x.value) {
      return resolve()
    }
    /* eslint-disable prefer-const */
    let stopWatch: WatchStopHandle
    stopWatch = watch(x, (loading) => {
      if (!loading) {
        stopWatch()
        resolve()
      }
    })
  })
}
