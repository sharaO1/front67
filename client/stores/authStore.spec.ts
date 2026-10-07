import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "./authStore";

describe("demo authentication", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  it("keeps the demo admin signed in without an invalid token", async () => {
    const success = await useAuthStore
      .getState()
      .login("admin@stockmind.local", "admin123");
    const state = useAuthStore.getState();

    expect(success).toBe(true);
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.role).toBe("super_admin");
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
  });
});
