import { useStaffStore } from "../store/staffStore";
import { ROLE_PERMISSIONS } from "../utils/permissions";

export function usePermissions() {
  const staff = useStaffStore((s) => s.currentStaff);

  if (!staff) {
    return { role: null, can: () => false, permissions: [] };
  }

  const permissions =
    staff.role === "custom"
      ? (staff.permissions ?? [])
      : (ROLE_PERMISSIONS[staff.role] ?? ROLE_PERMISSIONS.cashier);

  return {
    role: staff.role,
    can: (feature) => permissions.includes(feature),
    permissions,
  };
}
