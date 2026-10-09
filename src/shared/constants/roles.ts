// Role codes stored in roles.role_code. Keep in sync with the database.
export const RoleCode = {
  SUPER_ADMIN: "SUPER_ADMIN",
  USER: "USER",
} as const;

export type RoleCode = (typeof RoleCode)[keyof typeof RoleCode];
