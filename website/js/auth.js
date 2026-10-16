// Optional sign-in with Auth0. When AUTH0_DOMAIN and AUTH0_CLIENT_ID are set in .env,
// server.py passes them to the page; otherwise the site keeps using the demo login.
//
// The linked SwampTag key is also saved in the user's Auth0 profile
// (user_metadata.swamptag_key) through the Auth0 Management API, so it follows
// the user to any browser.
//
// Needs the Auth0 SPA SDK (global `auth0`) and config.js loaded first.

const DEMO_SESSION_KEY = 'swamptag-demo-login';

const Auth = {
  client: null,
  enabled: false,
  domain: '',
  profile: null,

  async init() {
    const cfg = await loadConfig();
    const settings = cfg.auth0;
    if (!settings || !settings.domain || !settings.clientId || typeof auth0 === 'undefined') return false;

    this.domain = settings.domain;
    try {
      this.client = await auth0.createAuth0Client({
        domain: settings.domain,
        clientId: settings.clientId,
        cacheLocation: 'localstorage',
        useRefreshTokens: true,
        useRefreshTokensFallback: true,
        authorizationParams: {
          redirect_uri: `${location.origin}/login.html`,
          // Asking for the Management API at sign-in means the consent screen
          // appears once during login (Auth0 always asks on localhost).
          audience: `https://${settings.domain}/api/v2/`,
          scope: 'openid profile email offline_access read:current_user update:current_user_metadata',
        },
      });
    } catch (err) {
      console.warn('Auth0 unavailable, using the demo login', err);
      return false;
    }
    this.enabled = true;
    return true;
  },

  // True when the user chose "Use demo account" in this tab.
  usingDemo() {
    try { return sessionStorage.getItem(DEMO_SESSION_KEY) === '1'; } catch { return false; }
  },

  startDemo() {
    try { sessionStorage.setItem(DEMO_SESSION_KEY, '1'); } catch { /* storage blocked: demo still opens */ }
  },

  // Finishes the Auth0 redirect if the URL has ?code=&state=. Returns true when it did.
  async handleRedirect() {
    const params = new URLSearchParams(location.search);
    if (!params.has('state') || !(params.has('code') || params.has('error'))) return false;
    try {
      await this.client.handleRedirectCallback();
    } finally {
      history.replaceState({}, '', location.pathname);
    }
    return true;
  },

  isAuthenticated() {
    return this.client.isAuthenticated();
  },

  login() {
    return this.client.loginWithRedirect();
  },

  logout() {
    try { sessionStorage.removeItem(DEMO_SESSION_KEY); } catch { /* ignore */ }
    if (!this.enabled) {
      location.href = 'index.html';
      return;
    }
    this.client.logout({ logoutParams: { returnTo: `${location.origin}/index.html` } });
  },

  async user() {
    this.profile = await this.client.getUser();
    return this.profile;
  },

  async managementApi(method, body) {
    const token = await this.client.getTokenSilently();
    const res = await fetch(`https://${this.domain}/api/v2/users/${encodeURIComponent(this.profile.sub)}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Auth0 Management API HTTP ${res.status}`);
    return res.json();
  },

  async getKey() {
    const user = await this.managementApi('GET');
    return (user.user_metadata && user.user_metadata.swamptag_key) || null;
  },

  // Pass null to remove the key from the profile.
  saveKey(uid) {
    return this.managementApi('PATCH', { user_metadata: { swamptag_key: uid } });
  },
};
