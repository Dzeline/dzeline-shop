import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { showToast } from "../utils/toast";
import {
  ASSIGNABLE_ROLES,
  FEATURE_LABELS,
  ALL_FEATURES,
  ROLE_LABELS,
  ROLE_COLORS,
  ROLE_PERMISSIONS,
} from "../utils/permissions";

// ── Role chip ────────────────────────────────────────────────────────────────
function RoleChip({ role }) {
  const label = ROLE_LABELS[role] ?? role;
  const colors = ROLE_COLORS[role] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors}`}>
      {label}
      {role === "admin" && " ★"}
    </span>
  );
}

// ── Role selector + custom permission toggles ────────────────────────────────
function RoleSelector({ value, permissions, onRoleChange, onPermsChange }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-1.5">
        {ASSIGNABLE_ROLES.map((r) => (
          <label
            key={r.id}
            className={`flex items-start gap-3 p-2.5 rounded-xl border cursor-pointer transition ${
              value === r.id
                ? "border-primary bg-blue-50"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <input
              type="radio"
              name="role"
              value={r.id}
              checked={value === r.id}
              onChange={() => onRoleChange(r.id)}
              className="mt-0.5 accent-primary shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">{r.label}</p>
              <p className="text-xs text-gray-400">{r.desc}</p>
            </div>
          </label>
        ))}
      </div>

      {value === "custom" && (
        <div className="border border-gray-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Features</p>
          {ALL_FEATURES.map((f) => (
            <label key={f} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={permissions.includes(f)}
                onChange={() => {
                  const next = permissions.includes(f)
                    ? permissions.filter((x) => x !== f)
                    : [...permissions, f];
                  onPermsChange(next);
                }}
                className="accent-primary"
              />
              <span className="text-sm text-gray-700">{FEATURE_LABELS[f]}</span>
            </label>
          ))}
        </div>
      )}

      {value !== "custom" && (
        <div className="border border-gray-100 bg-gray-50 rounded-xl p-3">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">Included access</p>
          <div className="flex flex-wrap gap-1">
            {(ROLE_PERMISSIONS[value] ?? []).map((f) => (
              <span key={f} className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                {FEATURE_LABELS[f]}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Staff row ────────────────────────────────────────────────────────────────
function StaffRow({ staff, isCurrentUser, onToggle, onChangePin, onChangeRole, onDelete }) {
  const [changingPin, setChangingPin] = useState(false);
  const [changingRole, setChangingRole] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [selectedRole, setSelectedRole] = useState(staff.role ?? "cashier");
  const [customPerms, setCustomPerms] = useState(staff.permissions ?? []);

  async function submitPinChange() {
    if (newPin.length < 4) { showToast("PIN must be at least 4 digits"); return; }
    if (newPin !== confirmPin) { showToast("PINs do not match"); return; }
    await onChangePin(staff.id, newPin);
    setChangingPin(false);
    setNewPin("");
    setConfirmPin("");
  }

  async function submitRoleChange() {
    if (selectedRole === "custom" && customPerms.length === 0) {
      showToast("Select at least one feature for custom role");
      return;
    }
    await onChangeRole(staff.id, selectedRole, customPerms);
    setChangingRole(false);
  }

  const isProtectedAdmin = staff.role === "admin";

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-gray-800 truncate">{staff.name}</span>
            {isCurrentUser && (
              <span className="text-xs font-semibold bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full shrink-0">You</span>
            )}
            <RoleChip role={staff.role} />
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {staff.active ? "Active" : "Inactive"} · Added{" "}
            {new Date(staff.created_at).toLocaleDateString("en-KE")}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isProtectedAdmin && !isCurrentUser && (
            <button
              onClick={() => onToggle(staff.id, !staff.active)}
              className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg transition ${
                staff.active
                  ? "bg-red-50 text-red-600 hover:bg-red-100"
                  : "bg-green-50 text-green-600 hover:bg-green-100"
              }`}
            >
              {staff.active ? "Off" : "On"}
            </button>
          )}
          {!isProtectedAdmin && !isCurrentUser && (
            <button
              onClick={() => { setChangingRole((v) => !v); setChangingPin(false); }}
              className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg transition ${
                changingRole ? "bg-indigo-100 text-indigo-600" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Role
            </button>
          )}
          <button
            onClick={() => { setChangingPin((v) => !v); setChangingRole(false); }}
            className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg transition ${
              changingPin ? "bg-indigo-100 text-indigo-600" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            PIN
          </button>
          {!isProtectedAdmin && !isCurrentUser && (
            <button
              onClick={() => onDelete(staff.id)}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 text-red-400 hover:bg-red-100 transition text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Change Role */}
      {changingRole && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Change Role</p>
          <RoleSelector
            value={selectedRole}
            permissions={customPerms}
            onRoleChange={(r) => { setSelectedRole(r); setCustomPerms([]); }}
            onPermsChange={setCustomPerms}
          />
          <div className="flex gap-2">
            <button
              onClick={submitRoleChange}
              className="flex-1 py-2 bg-primary text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition"
            >
              Save Role
            </button>
            <button
              onClick={() => { setChangingRole(false); setSelectedRole(staff.role); setCustomPerms(staff.permissions ?? []); }}
              className="px-4 py-2 bg-gray-100 text-gray-500 rounded-xl text-sm hover:bg-gray-200 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Change PIN */}
      {changingPin && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-1 block">New PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-1 block">Confirm PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            onClick={submitPinChange}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-blue-600 transition"
          >
            Save
          </button>
          <button
            onClick={() => { setChangingPin(false); setNewPin(""); setConfirmPin(""); }}
            className="px-3 py-2 bg-gray-100 text-gray-500 rounded-lg text-sm hover:bg-gray-200 transition"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────
export default function StaffManagement({ currentStaffId, onClose }) {
  const [staffList, setStaffList] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const [newRole, setNewRole] = useState("cashier");
  const [newCustomPerms, setNewCustomPerms] = useState([]);

  const load = useCallback(async () => {
    const list = await dbHelpers.getAllStaff();
    setStaffList(list);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(staffId, active) {
    await dbHelpers.toggleStaffActive(staffId, active);
    showToast(active ? "Staff activated" : "Staff deactivated");
    load();
  }

  async function handleChangePin(staffId, pin) {
    await dbHelpers.updateStaffPin(staffId, pin);
    showToast("PIN updated");
  }

  async function handleChangeRole(staffId, role, permissions) {
    await dbHelpers.updateStaffRole(staffId, role, permissions);
    showToast("Role updated");
    load();
  }

  async function handleDelete(staffId) {
    const member = staffList.find((s) => s.id === staffId);
    if (!window.confirm(`Remove ${member?.name ?? "this staff member"}? This cannot be undone.`)) return;
    await dbHelpers.deleteStaff(staffId);
    showToast("Staff removed");
    load();
  }

  async function handleAdd() {
    if (!newName.trim()) { showToast("Enter a name"); return; }
    if (newPin.length < 4) { showToast("PIN must be at least 4 digits"); return; }
    if (newPin !== newPinConfirm) { showToast("PINs do not match"); return; }
    if (newRole === "custom" && newCustomPerms.length === 0) {
      showToast("Select at least one feature for custom role");
      return;
    }
    await dbHelpers.addStaff(newName.trim(), newPin, newRole, newCustomPerms);
    showToast(`${newName.trim()} added`);
    setNewName(""); setNewPin(""); setNewPinConfirm("");
    setNewRole("cashier"); setNewCustomPerms([]);
    setShowAdd(false);
    load();
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        {onClose && (
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 shrink-0"
          >
            ‹
          </button>
        )}
        <div>
          <h2 className="font-bold text-white">Staff Management</h2>
          <p className="text-xs text-gray-400">
            {staffList.length} member{staffList.length !== 1 ? "s" : ""}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Add staff */}
        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            className="w-full py-3 border-2 border-dashed border-gray-700 rounded-2xl text-sm font-semibold text-gray-500 hover:border-primary hover:text-primary transition"
          >
            + Add Staff Member
          </button>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <p className="font-bold text-gray-700 text-sm">New Staff Member</p>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Full Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Jane Wanjiku"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Confirm PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={newPinConfirm}
                  onChange={(e) => setNewPinConfirm(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Role</label>
              <RoleSelector
                value={newRole}
                permissions={newCustomPerms}
                onRoleChange={(r) => { setNewRole(r); setNewCustomPerms([]); }}
                onPermsChange={setNewCustomPerms}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                className="flex-1 py-2.5 bg-primary text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition"
              >
                Add Staff
              </button>
              <button
                onClick={() => {
                  setShowAdd(false);
                  setNewName(""); setNewPin(""); setNewPinConfirm("");
                  setNewRole("cashier"); setNewCustomPerms([]);
                }}
                className="px-4 py-2.5 bg-gray-100 text-gray-500 rounded-xl text-sm hover:bg-gray-200 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Staff list */}
        {staffList.map((s) => (
          <StaffRow
            key={s.id}
            staff={s}
            isCurrentUser={s.id === currentStaffId}
            onToggle={handleToggle}
            onChangePin={handleChangePin}
            onChangeRole={handleChangeRole}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}
