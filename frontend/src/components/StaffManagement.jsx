import { useState, useEffect, useCallback } from "react";
import { dbHelpers } from "../services/db";
import { showToast } from "../utils/toast";

function StaffRow({ staff, isCurrentUser, onToggle, onChangePin, onDelete }) {
  const [changingPin, setChangingPin] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  async function submitPinChange() {
    if (newPin.length < 4) { showToast("PIN must be at least 4 digits"); return; }
    if (newPin !== confirmPin) { showToast("PINs do not match"); return; }
    await onChangePin(staff.id, newPin);
    setChangingPin(false);
    setNewPin("");
    setConfirmPin("");
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-800">{staff.name}</span>
            {isCurrentUser && (
              <span className="text-xs font-semibold bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">You</span>
            )}
            {staff.role === "admin" && (
              <span className="text-xs font-semibold bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Admin</span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {staff.active ? "Active" : "Inactive"} · Added {new Date(staff.created_at).toLocaleDateString("en-KE")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Active toggle — cannot deactivate yourself or admin */}
          {staff.role !== "admin" && !isCurrentUser && (
            <button
              onClick={() => onToggle(staff.id, !staff.active)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
                staff.active
                  ? "bg-red-50 text-red-600 hover:bg-red-100"
                  : "bg-green-50 text-green-600 hover:bg-green-100"
              }`}
            >
              {staff.active ? "Deactivate" : "Activate"}
            </button>
          )}

          <button
            onClick={() => setChangingPin((v) => !v)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
          >
            Change PIN
          </button>

          {staff.role !== "admin" && !isCurrentUser && (
            <button
              onClick={() => onDelete(staff.id)}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-400 hover:bg-red-100 transition"
            >
              ×
            </button>
          )}
        </div>
      </div>

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

export default function StaffManagement({ currentStaffId, onClose }) {
  const [staffList, setStaffList] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");

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
    await dbHelpers.addStaff(newName.trim(), newPin);
    showToast(`${newName.trim()} added`);
    setNewName(""); setNewPin(""); setNewPinConfirm(""); setShowAdd(false);
    load();
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 shrink-0"
        >
          ‹
        </button>
        <div>
          <h2 className="font-bold text-white">Staff Management</h2>
          <p className="text-xs text-gray-400">{staffList.length} member{staffList.length !== 1 ? "s" : ""}</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Add Staff */}
        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            className="w-full py-3 border-2 border-dashed border-gray-200 rounded-2xl text-sm font-semibold text-gray-400 hover:border-primary hover:text-primary transition"
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
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                className="flex-1 py-2.5 bg-primary text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition"
              >
                Add Staff
              </button>
              <button
                onClick={() => { setShowAdd(false); setNewName(""); setNewPin(""); setNewPinConfirm(""); }}
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
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}
