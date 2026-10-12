import React, { useState, useEffect } from 'react';
import { Race, Runner, PassTemplate } from '../../types/index.ts';
import { RunnerEditorModal } from './RunnerEditorModal.tsx';
import {
  Calendar,
  MapPin,
  Users,
  Plus,
  Search,
  Filter,
  Download,
  ExternalLink,
  Edit,
  Ban,
  CheckCircle,
  Clock,
  Sparkles,
  Smartphone,
  RefreshCw,
  X,
  Trash2,
  Mail,
  Copy,
  Check,
  AlertTriangle,
  Info,
} from 'lucide-react';

interface RacesTabProps {
  onOpenRunnerPass: (runnerId: string) => void;
  onNavigateTab: (tab: string) => void;
}

export const RacesTab: React.FC<RacesTabProps> = ({ onOpenRunnerPass, onNavigateTab }) => {
  const [races, setRaces] = useState<Race[]>([]);
  const [templates, setTemplates] = useState<PassTemplate[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<string>('');
  const [runners, setRunners] = useState<Runner[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'issued' | 'pending' | 'revoked'>('all');

  // Modals
  const [editingRunner, setEditingRunner] = useState<Runner | null>(null);
  const [showCreateRaceModal, setShowCreateRaceModal] = useState(false);
  const [showAddRunnerModal, setShowAddRunnerModal] = useState(false);
  const [revokingRunnerId, setRevokingRunnerId] = useState<string | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const [copiedRunnerId, setCopiedRunnerId] = useState<string | null>(null);
  const [participantResultModal, setParticipantResultModal] = useState<{
    runner: any;
    pass: any;
    emailDelivery: any;
    walletwalletDelivery?: any;
  } | null>(null);
  const [notificationMsg, setNotificationMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Create Race Form State
  const [newRaceName, setNewRaceName] = useState('');
  const [newRaceTemplateId, setNewRaceTemplateId] = useState('');
  const [newRaceDate, setNewRaceDate] = useState('2026-12-05T07:00');
  const [newRaceLocation, setNewRaceLocation] = useState('');

  // Add Runner Form State
  const [newRunnerFirst, setNewRunnerFirst] = useState('');
  const [newRunnerLast, setNewRunnerLast] = useState('');
  const [newRunnerEmail, setNewRunnerEmail] = useState('');
  const [newRunnerBib, setNewRunnerBib] = useState('5001');
  const [newRunnerWave, setNewRunnerWave] = useState('Wave A (07:00 AM)');
  const [newRunnerDiv, setNewRunnerDiv] = useState('Full Marathon (42.2K)');

  const fetchRaces = async () => {
    try {
      const res = await fetch('/api/races');
      const json = await res.json();
      if (json.success) {
        setRaces(json.data);
        if (json.data.length > 0 && !selectedRaceId) {
          setSelectedRaceId(json.data[0].id);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/templates');
      const json = await res.json();
      if (json.success) {
        setTemplates(json.data);
        if (json.data.length > 0 && !newRaceTemplateId) {
          setNewRaceTemplateId(json.data[0].id);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchRunners = async () => {
    try {
      setLoading(true);
      const url = selectedRaceId ? `/api/runners?race_id=${selectedRaceId}` : '/api/runners';
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setRunners(json.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRaces();
    fetchTemplates();
  }, []);

  useEffect(() => {
    if (selectedRaceId) {
      fetchRunners();
    }
  }, [selectedRaceId]);

  const handleCreateRace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRaceName || !newRaceTemplateId) return;

    try {
      const defaultMapping = {
        bib: 'bib_number',
        category: 'race_division',
        wave: 'start_wave',
        corral: 'corral_letter',
        expected_pace: 'target_pace',
        tshirt_size: 'tshirt_size',
        emergency_contact: 'emergency_contact',
        medical_notes: 'medical_notes',
      };

      const res = await fetch('/api/races', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRaceName,
          template_id: newRaceTemplateId,
          event_date: newRaceDate ? new Date(newRaceDate).toISOString() : new Date().toISOString(),
          location: newRaceLocation || 'Event Grounds',
          field_mapping: defaultMapping,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setShowCreateRaceModal(false);
        setNewRaceName('');
        setNewRaceLocation('');
        await fetchRaces();
        setSelectedRaceId(json.data.id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddRunner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRaceId || !newRunnerEmail || !newRunnerFirst) return;

    try {
      const res = await fetch('/api/runner/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          race_id: selectedRaceId,
          first_name: newRunnerFirst,
          last_name: newRunnerLast,
          email: newRunnerEmail,
          dynamic_data: {
            bib_number: newRunnerBib,
            bib: newRunnerBib,
            start_wave: newRunnerWave,
            race_division: newRunnerDiv,
            corral_letter: 'Chute Red 1',
            target_pace: '4:30 min/km',
            tshirt_size: 'Men L',
            emergency_contact: 'Family Contact (+1 555-0100)',
          },
          issue_immediate: true,
        }),
      });

      const json: any = await res.json();
      if (json.success) {
        setShowAddRunnerModal(false);
        const registeredEmail = newRunnerEmail;
        setNewRunnerFirst('');
        setNewRunnerLast('');
        setNewRunnerEmail('');
        fetchRunners();
        fetchRaces();

        // Always show the comprehensive Participant Result modal so the user
        // has instant access to their pass link and clear visibility into email delivery status!
        setParticipantResultModal({
          runner: json.data?.runner || { id: json.data?.runner_id, first_name: newRunnerFirst, last_name: newRunnerLast, email: registeredEmail },
          pass: json.data?.pass,
          emailDelivery: json.data?.email_delivery,
          walletwalletDelivery: json.data?.walletwallet_delivery,
        });

        if (json.data?.email_delivery?.success) {
          setNotificationMsg({
            type: 'success',
            text: `Participant registered & pass email dispatched to ${registeredEmail} via Resend!`,
          });
        } else if (json.data?.email_delivery?.error) {
          setNotificationMsg({
            type: 'info',
            text: `Participant saved in D1! Email note: ${json.data.email_delivery.error}`,
          });
        } else {
          setNotificationMsg({
            type: 'success',
            text: `Participant registered in D1!`,
          });
        }
        setTimeout(() => setNotificationMsg(null), 8000);
      }
    } catch (err: any) {
      console.error(err);
      setNotificationMsg({ type: 'error', text: err.message || 'Error registering participant' });
      setTimeout(() => setNotificationMsg(null), 8000);
    }
  };

  const handleCopyPassLink = (runnerId: string) => {
    const url = `${window.location.origin}/pass/${runnerId}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
    }
    setCopiedRunnerId(runnerId);
    setTimeout(() => setCopiedRunnerId(null), 2500);
  };

  const handleSendEmail = async (runnerId: string, emailAddr: string) => {
    try {
      setSendingEmailId(runnerId);
      const res = await fetch('/api/runner/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runner_id: runnerId }),
      });
      const json: any = await res.json();
      if (json.success) {
        setNotificationMsg({
          type: 'success',
          text: `Pass email dispatched to ${emailAddr} via Resend!`,
        });
      } else {
        const errorDetail = json.data?.error || json.message || json.error || 'Failed to dispatch via Resend.';
        const hintDetail = json.data?.hint ? ` (${json.data.hint})` : '';
        setNotificationMsg({
          type: 'error',
          text: `Email Notice: ${errorDetail}${hintDetail}`,
        });
      }
      setTimeout(() => setNotificationMsg(null), 10000);
    } catch (err: any) {
      setNotificationMsg({ type: 'error', text: err.message || 'Error triggering pass email' });
      setTimeout(() => setNotificationMsg(null), 8000);
    } finally {
      setSendingEmailId(null);
    }
  };

  const handleRevokePass = async (runnerId: string) => {
    try {
      setRevokingRunnerId(runnerId);
      const res = await fetch('/api/runner/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runner_id: runnerId, reason: 'Organizer revoked registration' }),
      });
      const json = await res.json();
      if (json.success) {
        fetchRunners();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRevokingRunnerId(null);
    }
  };

  const handleReissuePass = async (runnerId: string) => {
    try {
      const res = await fetch('/api/runner/reissue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runner_id: runnerId }),
      });
      const json = await res.json();
      if (json.success) {
        fetchRunners();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteRunner = async (runnerId: string) => {
    if (!confirm('Are you sure you want to delete this runner record from D1?')) return;
    try {
      const res = await fetch(`/api/runner/${runnerId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchRunners();
        fetchRaces();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const currentRace = races.find((r) => r.id === selectedRaceId);

  // Filter runners
  const filteredRunners = runners.filter((r) => {
    let dyn: Record<string, any> = {};
    try {
      dyn = JSON.parse(r.dynamic_data || '{}');
    } catch {
      dyn = {};
    }

    const bib = String(dyn.bib_number || dyn.bib || '');
    const fullName = `${r.first_name} ${r.last_name}`.toLowerCase();
    const email = r.email.toLowerCase();
    const query = searchQuery.toLowerCase();

    const matchesQuery = !query || fullName.includes(query) || email.includes(query) || bib.includes(query);
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'issued' && r.pass?.status === 'issued') ||
      (statusFilter === 'pending' && r.pass?.status === 'pending') ||
      (statusFilter === 'revoked' && r.pass?.status === 'revoked');

    return matchesQuery && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Toast Notification Banner */}
      {notificationMsg && (
        <div
          className={`p-3.5 rounded-2xl text-xs flex items-center justify-between border animate-fadeIn ${
            notificationMsg.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
              : notificationMsg.type === 'error'
              ? 'bg-rose-950/80 border-rose-500/40 text-rose-300'
              : 'bg-sky-950/80 border-sky-500/40 text-sky-300'
          }`}
        >
          <div className="flex items-center space-x-2">
            <Mail className="w-4 h-4 flex-shrink-0" />
            <span>{notificationMsg.text}</span>
          </div>
          <button
            onClick={() => setNotificationMsg(null)}
            className="text-xs opacity-70 hover:opacity-100 ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Header & Event Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Events & Participant Rosters</h2>
          <p className="text-xs text-slate-400">
            Manage registrations, issue dynamic Apple & Google passes, and push real-time updates.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowAddRunnerModal(true)}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center space-x-1.5 border border-slate-700 cursor-pointer transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Single Participant</span>
          </button>
          <button
            onClick={() => setShowCreateRaceModal(true)}
            className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center space-x-1.5 cursor-pointer shadow-md shadow-sky-500/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Create Event</span>
          </button>
        </div>
      </div>

      {/* Race Cards Horizontal Carousel / Tabs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {races.map((race) => {
          const isSelected = race.id === selectedRaceId;
          return (
            <div
              key={race.id}
              onClick={() => setSelectedRaceId(race.id)}
              className={`p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden ${
                isSelected
                  ? 'bg-slate-900 border-sky-500/80 shadow-lg shadow-sky-500/10 ring-1 ring-sky-500/50'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-sky-400 border border-slate-700 truncate max-w-[150px]">
                  {race.template_name}
                </span>
                <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  <span>{race.runner_count || 0} Runners</span>
                </span>
              </div>

              <h3 className="text-sm font-bold text-white mb-2 line-clamp-1">{race.name}</h3>

              <div className="space-y-1 text-xs text-slate-400">
                <div className="flex items-center space-x-1.5 truncate">
                  <MapPin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  <span className="truncate">{race.location}</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  <span>
                    {new Date(race.event_date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </div>

              {isSelected && (
                <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] font-semibold text-sky-400">
                  <span>Currently Managing</span>
                  <span>{race.issued_count || 0} passes issued</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Runner Table Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-sm font-bold text-white">
              {currentRace?.name || 'Event Participants'}
            </h3>
            <p className="text-xs text-slate-400">
              Showing {filteredRunners.length} participant{filteredRunners.length === 1 ? '' : 's'} registered in Cloudflare D1
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search bib, name, email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white placeholder-slate-500 outline-none w-48 sm:w-56"
              />
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-1.5 text-xs rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-slate-300 outline-none"
            >
              <option value="all">All Pass Status</option>
              <option value="issued">Issued</option>
              <option value="pending">Pending Queue</option>
              <option value="revoked">Revoked</option>
            </select>

            <button
              onClick={fetchRunners}
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer transition-all"
              title="Refresh Roster"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3">Bib #</th>
                <th className="py-3 px-3">Athlete</th>
                <th className="py-3 px-3">Division & Wave</th>
                <th className="py-3 px-3">Corral</th>
                <th className="py-3 px-3">Pass Status</th>
                <th className="py-3 px-3">Installed</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredRunners.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-500">
                    {loading ? 'Querying D1 runners table...' : 'No runners found matching your filters.'}
                  </td>
                </tr>
              ) : (
                filteredRunners.map((runner) => {
                  let dyn: Record<string, any> = {};
                  try {
                    dyn = JSON.parse(runner.dynamic_data || '{}');
                  } catch {
                    dyn = {};
                  }

                  const bib = dyn.bib_number || dyn.bib || 'TBD';
                  const division = dyn.race_division || dyn.category || 'Standard';
                  const wave = dyn.start_wave || dyn.wave || '-';
                  const corral = dyn.corral_letter || dyn.corral || '-';
                  const pass = runner.pass;
                  const isRevoked = pass?.status === 'revoked';

                  return (
                    <tr key={runner.id} className="hover:bg-slate-800/40 transition-colors">
                      {/* Bib */}
                      <td className="py-3 px-3">
                        <span className="font-mono font-bold text-sm text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/60">
                          {bib}
                        </span>
                      </td>

                      {/* Athlete */}
                      <td className="py-3 px-3">
                        <p className="font-bold text-white">
                          {runner.first_name} {runner.last_name}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate max-w-[180px]">
                          {runner.email}
                        </p>
                      </td>

                      {/* Division & Wave */}
                      <td className="py-3 px-3">
                        <p className="font-medium text-slate-200">{division}</p>
                        <p className="text-[11px] text-slate-400">{wave}</p>
                      </td>

                      {/* Corral */}
                      <td className="py-3 px-3 text-slate-300 font-medium">
                        {corral}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3">
                        {pass?.status === 'issued' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                            <CheckCircle className="w-3 h-3" /> Issued
                          </span>
                        ) : pass?.status === 'pending' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950 text-amber-400 border border-amber-800">
                            <Clock className="w-3 h-3" /> In Queue
                          </span>
                        ) : pass?.status === 'revoked' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-950 text-rose-400 border border-rose-800">
                            <Ban className="w-3 h-3" /> Revoked
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[11px]">Unissued</span>
                        )}
                      </td>

                      {/* Installed Badges */}
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-1.5">
                          <span
                            title={pass?.installed_apple ? 'Installed on Apple Wallet' : 'Not installed'}
                            className={`p-1 rounded ${
                              pass?.installed_apple
                                ? 'bg-white/20 text-white'
                                : 'bg-slate-800 text-slate-600'
                            }`}
                          >
                            <Smartphone className="w-3 h-3" />
                          </span>
                          <span
                            title={pass?.installed_google ? 'Saved to Google Wallet' : 'Not installed'}
                            className={`p-1 rounded ${
                              pass?.installed_google
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-slate-800 text-slate-600'
                            }`}
                          >
                            <Sparkles className="w-3 h-3" />
                          </span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          {/* Send / Resend Pass Email via Resend */}
                          <button
                            onClick={() => handleSendEmail(runner.id, runner.email)}
                            disabled={sendingEmailId === runner.id}
                            className="p-1.5 rounded-lg bg-sky-950/60 hover:bg-sky-900 text-sky-400 hover:text-sky-300 transition-all cursor-pointer"
                            title={`Send digital pass email to ${runner.email} via Resend`}
                          >
                            {sendingEmailId === runner.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Mail className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Copy Public Pass Link */}
                          <button
                            onClick={() => handleCopyPassLink(runner.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
                            title="Copy participant public pass link to clipboard"
                          >
                            {copiedRunnerId === runner.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Edit / Push APNs */}
                          <button
                            onClick={() => setEditingRunner(runner)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
                            title="Edit participant & push live APNs update"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>

                          {/* Open Pass Landing Page */}
                          <button
                            onClick={() => onOpenRunnerPass(runner.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 transition-all cursor-pointer"
                            title="Open verified participant landing page"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>

                          {/* Direct .pkpass download */}
                          <a
                            href={`/api/pass/download/${runner.id}`}
                            download
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 transition-all cursor-pointer"
                            title="Download .pkpass binary bundle"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>

                          {/* Revoke or Reissue */}
                          {isRevoked ? (
                            <button
                              onClick={() => handleReissuePass(runner.id)}
                              className="p-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 transition-all cursor-pointer"
                              title="Re-issue revoked pass"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRevokePass(runner.id)}
                              disabled={revokingRunnerId === runner.id}
                              className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 transition-all cursor-pointer"
                              title="Revoke and void pass on walletwallet.dev"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteRunner(runner.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 transition-all cursor-pointer"
                            title="Delete participant record"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Runner Editor Modal */}
      {editingRunner && (
        <RunnerEditorModal
          runner={editingRunner}
          onClose={() => setEditingRunner(null)}
          onSaveSuccess={() => {
            setEditingRunner(null);
            fetchRunners();
          }}
        />
      )}

      {/* Create Race Modal */}
      {showCreateRaceModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
              <h3 className="text-sm font-bold text-white">Create New Event / Race</h3>
              <button
                onClick={() => setShowCreateRaceModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateRace} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block uppercase font-bold text-slate-400 mb-1">Race Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Pacific Coast Trail Marathon 2026"
                  value={newRaceName}
                  onChange={(e) => setNewRaceName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white outline-none"
                />
              </div>

              <div>
                <label className="block uppercase font-bold text-slate-400 mb-1">Pass Design Template</label>
                <select
                  value={newRaceTemplateId}
                  onChange={(e) => setNewRaceTemplateId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white outline-none"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block uppercase font-bold text-slate-400 mb-1">Event Date & Time</label>
                  <input
                    type="datetime-local"
                    value={newRaceDate}
                    onChange={(e) => setNewRaceDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white outline-none"
                  />
                </div>
                <div>
                  <label className="block uppercase font-bold text-slate-400 mb-1">Location</label>
                  <input
                    type="text"
                    placeholder="e.g. Big Sur, CA"
                    value={newRaceLocation}
                    onChange={(e) => setNewRaceLocation(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-sky-500 text-white outline-none"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 text-[11px]">
                Field mapping automatically links participant CSV attributes (`bib_number`, `wave`, `division`, `corral`) to the selected pass schema.
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowCreateRaceModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold"
                >
                  Create Race in D1
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Single Runner Modal */}
      {showAddRunnerModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
              <h3 className="text-sm font-bold text-white">Add Participant to Event</h3>
              <button
                onClick={() => setShowAddRunnerModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddRunner} className="p-6 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block uppercase font-bold text-slate-400 mb-1">First Name</label>
                  <input
                    type="text"
                    required
                    value={newRunnerFirst}
                    onChange={(e) => setNewRunnerFirst(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white outline-none"
                  />
                </div>
                <div>
                  <label className="block uppercase font-bold text-slate-400 mb-1">Last Name</label>
                  <input
                    type="text"
                    required
                    value={newRunnerLast}
                    onChange={(e) => setNewRunnerLast(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block uppercase font-bold text-slate-400 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={newRunnerEmail}
                  onChange={(e) => setNewRunnerEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block uppercase font-bold text-slate-400 mb-1">Bib Number</label>
                  <input
                    type="text"
                    value={newRunnerBib}
                    onChange={(e) => setNewRunnerBib(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono font-bold outline-none"
                  />
                </div>
                <div>
                  <label className="block uppercase font-bold text-slate-400 mb-1">Start Wave</label>
                  <input
                    type="text"
                    value={newRunnerWave}
                    onChange={(e) => setNewRunnerWave(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block uppercase font-bold text-slate-400 mb-1">Division</label>
                <input
                  type="text"
                  value={newRunnerDiv}
                  onChange={(e) => setNewRunnerDiv(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white outline-none"
                />
              </div>

              <div className="p-3 rounded-xl bg-sky-950/40 border border-sky-800/60 text-sky-300 text-[11px] flex items-start space-x-2">
                <Info className="w-4 h-4 shrink-0 text-sky-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-white">Automated Pass Delivery via Resend</p>
                  <p className="text-slate-300">
                    Once saved to D1, an official digital pass will be issued and an automated invitation email will be dispatched to the participant with their magic wallet link.
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddRunnerModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold"
                >
                  Issue Pass & Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Participant Registration Result & Pass Access Modal */}
      {participantResultModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Participant Registered in D1</h3>
              </div>
              <button
                onClick={() => setParticipantResultModal(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              {/* Participant Summary */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="font-bold text-white text-sm">
                    {participantResultModal.runner.first_name} {participantResultModal.runner.last_name}
                  </div>
                  <div className="text-slate-400 text-xs">{participantResultModal.runner.email}</div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                  Pass Issued in D1
                </span>
              </div>

              {/* WalletWallet Pass Issuance Card */}
              {participantResultModal.walletwalletDelivery?.success ? (
                <div className="p-3.5 rounded-2xl bg-sky-950/40 border border-sky-800/60 text-sky-300 space-y-2">
                  <div className="font-bold text-white flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-sky-400" />
                      Signed Pass Issued via WalletWallet.dev ({participantResultModal.walletwalletDelivery.tierUsed === 'free' ? 'Free Tier' : 'Pro Tier'})
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-900/60 text-sky-300 font-mono">
                      {participantResultModal.walletwalletDelivery.serialNumber ? `Serial: ${participantResultModal.walletwalletDelivery.serialNumber.slice(0, 10)}...` : 'Active'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Dual Apple Wallet (.pkpass) and Google Wallet tokens generated globally via Cloudflare Workers.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {participantResultModal.pass?.google_save_url && (
                      <a
                        href={participantResultModal.pass.google_save_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-semibold text-[11px] flex items-center gap-1.5 transition-all"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                        <span>Direct Save to Google Wallet ↗</span>
                      </a>
                    )}
                    <a
                      href={`/pass/${participantResultModal.runner.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-[11px] flex items-center gap-1.5 transition-all shadow-sm"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open Pass Landing Page ↗</span>
                    </a>
                  </div>
                </div>
              ) : participantResultModal.walletwalletDelivery?.error ? (
                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-slate-400 space-y-1 text-[11px]">
                  <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-slate-400" />
                    WalletWallet Notice: {participantResultModal.walletwalletDelivery.error}
                  </div>
                  <p>
                    Pass generated in Edge D1 database. To issue through official WalletWallet certificates (free tier up to 1,000 passes/mo), configure your key in Admin Settings.
                  </p>
                </div>
              ) : null}

              {/* Email Delivery Status Card */}
              {participantResultModal.emailDelivery?.success ? (
                <div className="p-3.5 rounded-2xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 space-y-1">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    Pass Email Dispatched via Resend
                  </div>
                  <p className="text-[11px] text-emerald-200/80">
                    An email containing the digital pass link has been sent to{' '}
                    <span className="font-semibold text-white">{participantResultModal.runner.email}</span>.
                    {participantResultModal.emailDelivery.resendId && (
                      <span className="ml-1 text-[10px] font-mono text-emerald-400">
                        (ID: {participantResultModal.emailDelivery.resendId})
                      </span>
                    )}
                  </p>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-800/60 text-amber-200 space-y-2">
                  <div className="font-bold text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    Email Delivery Notice
                  </div>
                  <p className="text-[11px] text-amber-200/90 leading-relaxed">
                    {participantResultModal.emailDelivery?.error || 'Email was not dispatched because Resend API key is not configured.'}
                  </p>
                  {participantResultModal.emailDelivery?.hint && (
                    <div className="p-2.5 rounded-xl bg-amber-900/30 border border-amber-800/40 text-[10.5px] text-amber-300 leading-relaxed">
                      💡 <strong>Notice:</strong> {participantResultModal.emailDelivery.hint}
                    </div>
                  )}
                  <div className="text-[11px] text-slate-400 pt-1 border-t border-amber-800/40 flex items-center justify-between">
                    <span>Need to configure or test Resend?</span>
                    <button
                      onClick={() => {
                        setParticipantResultModal(null);
                        onNavigateTab('cloudflare');
                      }}
                      className="text-sky-400 hover:text-sky-300 font-bold underline cursor-pointer"
                    >
                      Open Admin Settings →
                    </button>
                  </div>
                </div>
              )}

              {/* Direct Instant Pass Access Link */}
              <div className="space-y-1.5">
                <label className="block uppercase font-bold text-slate-400 text-[10px]">
                  Direct Participant Pass URL (Instant Access)
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/pass/${participantResultModal.runner.id}`}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sky-400 font-mono text-[11px] outline-none"
                  />
                  <button
                    onClick={() => handleCopyPassLink(participantResultModal.runner.id)}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer shrink-0"
                  >
                    {copiedRunnerId === participantResultModal.runner.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">
                  You or the participant can open this URL directly in any browser on iPhone or Android to add the pass into Apple or Google Wallet.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setParticipantResultModal(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenRunnerPass(participantResultModal.runner.id);
                    setParticipantResultModal(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold flex items-center space-x-1.5 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Digital Pass Now</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
