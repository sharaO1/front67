import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  Role,
  Resource,
  Action,
  RBACUser,
  Permission,
  hasPermission,
  canAccessResource,
  getAllowedActions,
  isHigherRole,
  ROLE_PERMISSIONS,
  NAVIGATION_PERMISSIONS,
} from "@shared/rbac";
import {
  API_BASE,
  joinApi,
  getErrorMessageFromResponse,
  extractErrorMessage,
} from "@/lib/api";

// Framework validation helpers
const VALID_ACTIONS: Action[] = [
  "create",
  "read",
  "update",
  "delete",
  "export",
  "import",
  "approve",
  "reject",
  "assign",
];

const VALID_RESOURCES: Resource[] = [
  "users",
  "employees",
  "clients",
  "sales",
  "finance",
  "dashboard",
  "settings",
  "reports",
  "audit_logs",
  "system_config",
];

const validateFrameworkAction = (action: Action): boolean => {
  return VALID_ACTIONS.includes(action);
};

const validateFrameworkResource = (resource: Resource): boolean => {
  return VALID_RESOURCES.includes(resource);
};

interface RBACState {
  // Current user's RBAC context
  currentUser: RBACUser | null;

  // Permission checking methods
  hasPermission: (resource: Resource, action: Action, context?: any) => boolean;
  canAccessResource: (resource: Resource) => boolean;
  getAllowedActions: (resource: Resource) => Action[];
  canAccessRoute: (path: string) => boolean;

  // Role management methods
  isHigherRole: (targetRole: Role) => boolean;
  canManageUser: (targetUserId: string, targetRole: Role) => boolean;

  // User management (for admin interfaces)
  users: RBACUser[];
  isLoadingUsers: boolean;
  loadUsers: () => Promise<{ ok: boolean; message?: string }>;
  updateUserRole: (userId: string, newRole: Role) => Promise<boolean>;
  updateUserStatus: (
    userId: string,
    status: "active" | "inactive" | "suspended",
  ) => Promise<boolean>;

  // Audit and security
  auditLogs: AuditLog[];
  logAction: (action: string, resource: string, details?: any) => void;

  // UI state
  selectedUser: RBACUser | null;
  setSelectedUser: (user: RBACUser | null) => void;

  // Initialize from auth store
  initializeFromAuth: (user: any) => void;
  reset: () => void;
}

interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resource: string;
  timestamp: Date;
  details?: any;
  ipAddress?: string;
}

export const useRBACStore = create<RBACState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      users: [],
      isLoadingUsers: false,
      auditLogs: [],
      selectedUser: null,

      // Permission checking methods with framework validation
      hasPermission: (resource: Resource, action: Action, context?: any) => {
        const { currentUser } = get();
        if (!currentUser) return false;

        // Validate that the resource and action are defined in the framework
        if (!validateFrameworkResource(resource)) {
          console.warn(
            `Invalid resource "${resource}" not defined in framework`,
          );
          return false;
        }

        if (!validateFrameworkAction(action)) {
          console.warn(`Invalid action "${action}" not defined in framework`);
          return false;
        }

        const permissionContext = {
          userId: currentUser.id,
          department: currentUser.department,
          region: currentUser.region,
          ...context,
        };

        return hasPermission(
          currentUser.role,
          resource,
          action,
          permissionContext,
        );
      },

      canAccessResource: (resource: Resource) => {
        const { currentUser } = get();
        if (!currentUser) return false;
        return canAccessResource(currentUser.role, resource);
      },

      getAllowedActions: (resource: Resource) => {
        const { currentUser } = get();
        if (!currentUser) return [];
        return getAllowedActions(currentUser.role, resource);
      },

      canAccessRoute: (path: string) => {
        const { currentUser } = get();
        if (!currentUser) return false;

        const navPermission = NAVIGATION_PERMISSIONS.find(
          (nav) => path.startsWith(nav.path) || nav.path === path,
        );

        if (!navPermission) return true; // Allow access to routes not defined in permissions

        // Check role requirement
        if (!navPermission.requiredRole.includes(currentUser.role)) {
          return false;
        }

        // Check specific permission if defined
        if (navPermission.requiredPermission) {
          return get().hasPermission(
            navPermission.requiredPermission.resource,
            navPermission.requiredPermission.action,
          );
        }

        return true;
      },

      // Role management methods
      isHigherRole: (targetRole: Role) => {
        const { currentUser } = get();
        if (!currentUser) return false;
        return isHigherRole(currentUser.role, targetRole);
      },

      canManageUser: (targetUserId: string, targetRole: Role) => {
        const { currentUser } = get();
        if (!currentUser) return false;

        // Can't manage yourself for role changes
        if (currentUser.id === targetUserId) return false;

        // Must have user management permission
        if (!get().hasPermission("users", "update")) return false;

        // Must have higher role than target
        return get().isHigherRole(targetRole);
      },

      // User management
      loadUsers: async () => {
        const { currentUser } = get();
        if (!currentUser || !get().hasPermission("users", "read")) {
          return { ok: false, message: "Insufficient permissions" };
        }

        set({ isLoadingUsers: true });

        try {
          const { useAuthStore } = await import("./authStore");
          const token = useAuthStore.getState().accessToken;
          if (!token) {
            set({ isLoadingUsers: false });
            return { ok: false, message: "Not authenticated" };
          }

          const res = await fetch(joinApi("/users/all/users"), {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          });

          if (!res.ok) {
            const msg = await getErrorMessageFromResponse(res);
            set({ users: [], isLoadingUsers: false });
            return { ok: false, message: msg };
          }

          const data = await res.json();

          if (!data?.ok || !Array.isArray(data.result)) {
            const msg = String(
              data?.message ||
                data?.error ||
                data?.details ||
                "Failed to load users",
            );
            set({ users: [], isLoadingUsers: false });
            return { ok: false, message: msg };
          }

          const origin = (() => {
            try {
              return new URL(API_BASE).origin;
            } catch {
              return API_BASE.replace(/\/api\/?$/, "");
            }
          })();

          const mapRole = (role: string): Role => {
            const normalized = role?.toLowerCase();
            switch (normalized) {
              case "super_admin":
              case "superadmin":
                return "super_admin";
              case "admin":
                return "admin";
              case "manager":
                return "manager";
              case "team_lead":
              case "teamlead":
                return "team_lead";
              case "employee":
              case "worker":
                return "employee";
              case "intern":
                return "intern";
              case "viewer":
              default:
                return "viewer";
            }
          };

          const toAbs = (input?: unknown) => {
            const avatar =
              typeof input === "string"
                ? input
                : input &&
                    typeof input === "object" &&
                    "url" in (input as any) &&
                    typeof (input as any).url === "string"
                  ? (input as any).url
                  : undefined;
            if (!avatar) return undefined;
            if (/^(https?:)?\/\//i.test(avatar)) return avatar;
            if (avatar.startsWith("data:")) return avatar;
            const base = API_BASE.replace(/\/+$/, "");
            if (avatar.startsWith("/api/")) return `${origin}${avatar}`;
            if (avatar.startsWith("/")) return `${base}${avatar}`; // keep /api prefix
            if (/^(api\/|uploads\/|static\/|files\/)/i.test(avatar))
              return `${base}/${avatar}`;
            return `${base}/${avatar}`;
          };

          const pickAvatar = (u: any) => {
            const candidate =
              u.avatar ??
              u.avatarUrl ??
              u.image ??
              u.imageUrl ??
              u.profileImage ??
              u.profile_image ??
              u.photo ??
              u.photoUrl ??
              u.picture ??
              u.profilePicture ??
              u.profile_picture ??
              undefined;
            return toAbs(candidate);
          };

          const users: RBACUser[] = data.result.map((u: any) => {
            const role = mapRole(u.role);
            const name =
              [u.firstname, u.lastname].filter(Boolean).join(" ").trim() ||
              u.name ||
              u.email;
            const rawFilial =
              u.filial ??
              u.branch ??
              u.store ??
              u.location ??
              u.workLocation ??
              u.work_location;
            const filialId =
              u.filialId ??
              u.filialID ??
              u.filial_id ??
              u.storeId ??
              u.store_id ??
              u.branchId ??
              u.branch_id ??
              u.locationId ??
              u.location_id ??
              u.workLocationId ??
              u.work_location_id ??
              (rawFilial && typeof rawFilial === "object"
                ? rawFilial.id ??
                  rawFilial.filialId ??
                  rawFilial.filial_id ??
                  rawFilial.storeId ??
                  rawFilial.branchId
                : undefined);
            const filialName =
              u.filialName ??
              u.filial_name ??
              u.locationName ??
              u.location_name ??
              u.storeName ??
              u.store_name ??
              u.branchName ??
              u.branch_name ??
              (typeof rawFilial === "string"
                ? rawFilial
                : rawFilial && typeof rawFilial === "object"
                  ? rawFilial.name ??
                    rawFilial.title ??
                    rawFilial.filialName ??
                    rawFilial.filial_name ??
                    rawFilial.storeName ??
                    rawFilial.branchName
                  : undefined);
            return {
              id: u.id,
              email: u.email,
              name,
              role,
              permissions: ROLE_PERMISSIONS[role],
              department: u.department || undefined,
              filialId: filialId == null ? undefined : String(filialId),
              filialName:
                typeof filialName === "string" ? filialName : undefined,
              avatar: pickAvatar(u),
              status:
                (u.status?.toLowerCase?.() as RBACUser["status"]) || "active",
              createdAt: new Date(u.createdAt || Date.now()),
              updatedAt: new Date(u.updatedAt || Date.now()),
            };
          });

          set({ users, isLoadingUsers: false });
          get().logAction("load_users", "users");
          return { ok: true };
        } catch (err) {
          console.error("Failed to load users", err);
          set({ users: [], isLoadingUsers: false });
          return {
            ok: false,
            message: extractErrorMessage(err, "Failed to load users"),
          };
        }
      },

      updateUserRole: async (userId: string, newRole: Role) => {
        const { currentUser, users } = get();
        if (!currentUser || !get().canManageUser(userId, newRole)) {
          return false;
        }

        // Simulate API delay
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Update local state (mock implementation)
        const updatedUsers = users.map((user) =>
          user.id === userId
            ? {
                ...user,
                role: newRole,
                permissions: ROLE_PERMISSIONS[newRole],
                updatedAt: new Date(),
              }
            : user,
        );

        set({ users: updatedUsers });
        get().logAction("update_user_role", "users", { userId, newRole });
        return true;
      },

      updateUserStatus: async (
        userId: string,
        status: "active" | "inactive" | "suspended",
      ) => {
        const { currentUser, users } = get();
        if (!currentUser || !get().hasPermission("users", "update")) {
          return false;
        }

        // Can't change your own status
        if (currentUser.id === userId) {
          return false;
        }

        // Simulate API delay
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Update local state (mock implementation)
        const updatedUsers = users.map((user) =>
          user.id === userId
            ? { ...user, status, updatedAt: new Date() }
            : user,
        );

        set({ users: updatedUsers });
        get().logAction("update_user_status", "users", { userId, status });
        return true;
      },

      // Audit logging
      logAction: (action: string, resource: string, details?: any) => {
        const { currentUser, auditLogs } = get();
        if (!currentUser) return;

        const newLog: AuditLog = {
          id: Date.now().toString(),
          userId: currentUser.id,
          action,
          resource,
          timestamp: new Date(),
          details,
          ipAddress: "unknown", // Would get actual IP in real implementation
        };

        set({
          auditLogs: [newLog, ...auditLogs.slice(0, 99)], // Keep last 100 logs
        });
      },

      // UI state management
      setSelectedUser: (user: RBACUser | null) => {
        set({ selectedUser: user });
      },

      // Initialize from auth store
      initializeFromAuth: (user: any) => {
        if (!user) {
          set({ currentUser: null });
          return;
        }

        const userRole = user.role as Role;
        const validRole = ROLE_PERMISSIONS[userRole] ? userRole : "viewer";

        const rbacUser: RBACUser = {
          id: user.id,
          email: user.email,
          name: user.name,
          role: validRole,
          permissions: ROLE_PERMISSIONS[validRole] || [],
          avatar: user.avatar,
          filialId: (user as any).filialId || undefined,
          filialName: (user as any).location || undefined,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        set({ currentUser: rbacUser });
        get().logAction("login", "auth");
      },

      reset: () => {
        set({
          currentUser: null,
          users: [],
          isLoadingUsers: false,
          auditLogs: [],
          selectedUser: null,
        });
      },
    }),
    {
      name: "rbac-storage",
      partialize: (state) => ({
        currentUser: state.currentUser,
        auditLogs: state.auditLogs.slice(0, 10), // Persist only recent logs
      }),
    },
  ),
);
