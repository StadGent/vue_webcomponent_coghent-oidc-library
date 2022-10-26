import { App, ref, reactive, Ref, inject, watch, WatchStopHandle } from "vue";
import { NavigationGuardNext } from "vue-router";
export interface OpenIdConnectConfiguration {
  baseUrl: string;
  tokenEndpoint: string;
  authEndpoint: string;
  logoutEndpoint: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
  serverBaseUrl?: string;
  serverTokenEndpoint?: string;
  serverRefreshEndpoint?: string;
  internalRedirectUrl?: string;
  apiCodeEndpoint?: string;
  redirectUri: string;
  kcIdpHint: string | "no-hint";
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
};

export interface OpenIdConnectUserInformation {
  name: string;
  preferred_username: string;
  given_name: string;
  family_name: string;
  email: string;
}

export const DefaultOIDC: unique symbol = Symbol("Auth");
export const useAuth = () => inject<OpenIdConnectClient>(DefaultOIDC)!;

export class OpenIdConnectClient {
  isAuthenticated: Ref<boolean>;
  loading: Ref<boolean>;
  error: unknown;
  config: OpenIdConnectConfiguration;
  user: string | null;

  constructor(config: Partial<OpenIdConnectConfiguration>) {
    this.isAuthenticated = ref(false);
    this.loading = ref(false);
    this.error = undefined;
    this.config = reactive({ ...defaultConfig, ...config });
    this.user = null;
  }

  install(app: App): void {
    app.provide<OpenIdConnectClient>(DefaultOIDC, this);
  }

  async changeRedirectRoute(route: string): Promise<void> {
    this.config.redirectUri = route.replace(/\/\s*$/, "");
  }

  async processAuthCode(authCode: string): Promise<void> {
    this.loading.value = true;
    try {
      await this.sendReceivedCode(authCode);
      await this.verifyServerAuth();
    } catch (e) {
      this.isAuthenticated.value = false;
      this.error = e;
    }
    this.loading.value = false;
  }

  async verifyServerAuth(): Promise<void> {
    this.loading.value = true;
    try {
      const response = await fetch("/api/me", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      if (response) {
        this.user = await response.json();
        if (response.status)
          this.isAuthenticated.value = response.status !== 401;
      }
    } catch (e) {
      this.isAuthenticated.value = false;
      this.user = null;
      this.error = e;
    }
    this.loading.value = false;
  }

  async sendReceivedCode(authCode: string): Promise<void> {
    const { apiCodeEndpoint, baseUrl, clientId, tokenEndpoint } = this.config;
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
    });
  }

  redirectToLogin(): void {
    const { authEndpoint, baseUrl, clientId, scope } = this.config;

    let params = new URLSearchParams({
      scope: scope || "openid",
      client_id: clientId,
      response_type: "code",
      redirect_uri: this.config.redirectUri,
    });
    if (this.config.kcIdpHint !== "no-hint") {
      params = new URLSearchParams({
        scope: scope || "openid",
        client_id: clientId,
        response_type: "code",
        redirect_uri: this.config.redirectUri,
        kc_idp_hint: this.config.kcIdpHint,
      });
    }
    window.location.href = `${baseUrl}${authEndpoint}?${params}`;
  }

  async assertIsAuthenticated(
    dest: string,
    cb: NavigationGuardNext
  ): Promise<void> {
    await waitTillFalse(this.loading);
    if (this.isAuthenticated.value) {
      this.verifyServerAuth();
      return cb();
    }
    await this.verifyServerAuth();
    await waitTillFalse(this.loading);
    if (this.isAuthenticated.value) {
      return cb();
    }
    this.redirectToLogin();
    return cb(false);
  }

  resetAuthProperties(): void {
    this.isAuthenticated.value = false;
    this.user = null;
  }

  async logout() {
    return fetch("/api/logout").then(() => {
      this.resetAuthProperties();
    });
  }
}

async function waitTillFalse(x: Ref<unknown>): Promise<void> {
  return new Promise((resolve) => {
    if (!x.value) {
      return resolve();
    }
    const stopWatch: WatchStopHandle = watch(x, (loading) => {
      if (!loading) {
        stopWatch();
        resolve();
      }
    });
  });
}
