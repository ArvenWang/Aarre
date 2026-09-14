import { expect, it, vi } from "vitest";

it("A07 keeps a recoverable session when refresh fails because the network is offline", async () => {
  vi.stubEnv("VITE_AARRE_API_BASE_URL", "https://audit.invalid");
  const key = "aarre:cloud-session:v1";
  const values: Record<string, unknown> = { [key]: {
    accessToken: "audit-fixture-access", refreshToken: "audit-fixture-refresh",
    accessExpiresAt: "2000-01-01T00:00:00.000Z", refreshExpiresAt: "2099-01-01T00:00:00.000Z",
    userId: "audit-user", profile: { email: "audit@example.test", name: "Audit", avatarUrl: "" }
  } };
  vi.stubGlobal("chrome", { storage: { local: {
    get: async (k: string) => ({ [k]: values[k] }),
    set: async (next: Record<string, unknown>) => Object.assign(values, next),
    remove: async (k: string) => { delete values[k]; }
  } } });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("injected offline network"); }));
  const { cloudRequest } = await import("../src/lib/auth");
  await expect(cloudRequest("/v1/account")).rejects.toThrow("offline");
  console.log("A07", { sessionRetainedAfterNetworkFailure: Boolean(values[key]) });
  expect(values[key]).toBeDefined();
});

it('rejects the response from an account that was switched while a request was pending',async()=>{
  vi.stubEnv('VITE_AARRE_API_BASE_URL','https://audit.invalid');
  const key='aarre:cloud-session:v1'; const session={accessToken:'fixture-access',refreshToken:'fixture-refresh',accessExpiresAt:'2099-01-01T00:00:00.000Z',refreshExpiresAt:'2099-01-01T00:00:00.000Z',userId:'account-a',profile:{email:'a@example.test',name:'A',avatarUrl:''}};
  const values:Record<string,any>={[key]:session};
  vi.stubGlobal('chrome',{storage:{local:{get:async(k:string)=>({[k]:values[k]}),set:async(v:any)=>Object.assign(values,v),remove:async(k:string)=>{delete values[k]}}}});
  vi.stubGlobal('fetch',vi.fn(async()=>{values[key]={...session,userId:'account-b',accessToken:'new-account-token'};return new Response(JSON.stringify({privateData:'old-account'}),{status:200});}));
  const {cloudRequest}=await import('../src/lib/auth');
  await expect(cloudRequest('/v1/account')).rejects.toThrow('账号已变化');
  expect(values[key].userId).toBe('account-b');expect(fetch).toHaveBeenCalledTimes(1);
});
