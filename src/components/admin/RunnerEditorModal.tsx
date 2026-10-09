import React, { useState } from 'react';
import { Runner } from '../../types/index.ts';
import { X, Save, Radio, AlertTriangle } from 'lucide-react';

interface RunnerEditorModalProps {
  runner: Runner;
  onClose: () => void;
  onSaveSuccess: () => void;
}

export const RunnerEditorModal: React.FC<RunnerEditorModalProps> = ({
  runner,
  onClose,
  onSaveSuccess,
}) => {
  const [firstName, setFirstName] = useState(runner.first_name);
  const [lastName, setLastName] = useState(runner.last_name);
  const [email, setEmail] = useState(runner.email);

  let initialDyn: Record<string, any> = {};
  try {
    initialDyn = JSON.parse(runner.dynamic_data || '{}');
  } catch {
    initialDyn = {};
  }

  const [bib, setBib] = useState(initialDyn.bib_number || initialDyn.bib || '1042');
  const [wave, setWave] = useState(initialDyn.start_wave || initialDyn.wave || 'Wave A (06:30 AM)');
  const [corral, setCorral] = useState(initialDyn.corral_letter || initialDyn.corral || 'Chute Red 1');
  const [division, setDivision] = useState(initialDyn.race_division || initialDyn.category || 'Full Marathon (42.2K)');
  const [targetPace, setTargetPace] = useState(initialDyn.target_pace || '4:15 min/km');
  const [tshirtSize, setTshirtSize] = useState(initialDyn.tshirt_size || 'Men L');
  const [emergencyContact, setEmergencyContact] = useState(initialDyn.emergency_contact || '');
  const [medicalNotes, setMedicalNotes] = useState(initialDyn.medical_notes || '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError(null);

      const updatedDyn: Record<string, any> = {
        ...initialDyn,
        bib_number: bib,
        bib: bib,
        start_wave: wave,
        wave: wave,
        corral_letter: corral,
        corral: corral,
        race_division: division,
        category: division,
        target_pace: targetPace,
        tshirt_size: tshirtSize,
        emergency_contact: emergencyContact,
        medical_notes: medicalNotes,
      };

      // Detect primary change for push log
      let fieldChanged = 'profile_updated';
      let oldVal = '';
      let newVal = '';

      if (bib !== (initialDyn.bib_number || initialDyn.bib)) {
        fieldChanged = 'bib_number';
        oldVal = String(initialDyn.bib_number || initialDyn.bib || '');
        newVal = bib;
      } else if (wave !== (initialDyn.start_wave || initialDyn.wave)) {
        fieldChanged = 'start_wave';
        oldVal = String(initialDyn.start_wave || initialDyn.wave || '');
        newVal = wave;
      } else if (corral !== (initialDyn.corral_letter || initialDyn.corral)) {
        fieldChanged = 'corral_letter';
        oldVal = String(initialDyn.corral_letter || initialDyn.corral || '');
        newVal = corral;
      }

      const res = await fetch('/api/runner/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runner_id: runner.id,
          first_name: firstName,
          last_name: lastName,
          email,
          dynamic_data: updatedDyn,
          field_changed: fieldChanged,
          old_value: oldVal,
          new_value: newVal,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to update runner record');
      }

      onSaveSuccess();
    } catch (err: any) {
      setError(err.message || 'Error updating participant');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl animate-scaleIn">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center space-x-2">
            <Radio className="w-4 h-4 text-sky-400" />
            <h3 className="text-base font-bold text-white">Edit Participant & Push APNs Update</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div className="p-3 bg-sky-950/40 border border-sky-800/40 rounded-xl text-xs text-sky-300">
            <strong>Live Lockscreen Push:</strong> Modifying bib, wave, or corral will automatically trigger an APNs / FCM silent notification directly to this participant's device pass!
          </div>

          {error && (
            <div className="p-3 bg-rose-950/50 border border-rose-800/50 text-rose-300 rounded-xl text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                First Name
              </label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-xs outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Last Name
              </label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-xs outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-xs outline-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Bib Number
              </label>
              <input
                type="text"
                value={bib}
                onChange={(e) => setBib(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-xs font-mono font-bold outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Start Wave
              </label>
              <input
                type="text"
                value={wave}
                onChange={(e) => setWave(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-xs outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Corral Gate
              </label>
              <input
                type="text"
                value={corral}
                onChange={(e) => setCorral(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-xs outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Division / Category
              </label>
              <input
                type="text"
                value={division}
                onChange={(e) => setDivision(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-xs outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Target Pace
              </label>
              <input
                type="text"
                value={targetPace}
                onChange={(e) => setTargetPace(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-xs outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Shirt Size
              </label>
              <input
                type="text"
                value={tshirtSize}
                onChange={(e) => setTshirtSize(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-xs outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Emergency Contact
              </label>
              <input
                type="text"
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-xs outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Medical Notes / Allergies
            </label>
            <input
              type="text"
              value={medicalNotes}
              onChange={(e) => setMedicalNotes(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white text-xs outline-none"
            />
          </div>

          {/* Footer Buttons */}
          <div className="pt-4 border-t border-slate-800 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center space-x-2 transition-all cursor-pointer shadow-lg shadow-sky-500/20 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Pushing Update to APNs...' : 'Save & Push Pass Update'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
