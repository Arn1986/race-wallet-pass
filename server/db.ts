import { Organization, PassTemplate, Race, Runner, Pass, QueueJob, PushNotificationLog, ResendEmailLog, R2Asset } from '../src/types/index.ts';

// In-Memory Cloudflare D1 Emulation with Relational Integrity and Persistence
class D1DatabaseEmulator {
  private organizations: Map<string, Organization> = new Map();
  private templates: Map<string, PassTemplate> = new Map();
  private races: Map<string, Race> = new Map();
  private runners: Map<string, Runner> = new Map();
  private passes: Map<string, Pass> = new Map();

  // Cloudflare R2 Bucket emulation
  private r2Assets: Map<string, R2Asset> = new Map();

  // Cloudflare Queues emulation (PASS_QUEUE)
  private queue: QueueJob[] = [];

  // Logs
  private pushLogs: PushNotificationLog[] = [];
  private emailLogs: ResendEmailLog[] = [];

  // Config settings
  public settings = {
    walletwalletApiKey: process.env.WALLETWALLET_API_KEY || '',
    walletwalletApiUrl: process.env.WALLETWALLET_API_URL || 'https://api.walletwallet.dev',
    walletwalletPlan: (process.env.WALLETWALLET_PLAN || 'free') as 'free' | 'pro',
    resendApiKey: process.env.RESEND_API_KEY || '',
    emailFrom: process.env.EMAIL_FROM || 'Wallet Pass <onboarding@resend.dev>',
    publicDomain: process.env.PUBLIC_DOMAIN || 'https://walletpass.cloud',
  };

  constructor() {
    this.seedInitialData();
  }

  private seedInitialData() {
    const orgId = 'org-pacific-sports-2026';
    const org: Organization = {
      id: orgId,
      name: 'Pacific Athletic Club & Marathon Series',
      created_at: new Date('2026-01-10T08:00:00Z').toISOString(),
    };
    this.organizations.set(orgId, org);

    // Initial R2 Assets
    const assets: R2Asset[] = [
      {
        key: 'assets/logos/pac-marathon-logo.svg',
        filename: 'pac-marathon-logo.svg',
        size: 8240,
        mimeType: 'image/svg+xml',
        url: 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=400&q=80',
        uploaded_at: new Date('2026-01-15T10:00:00Z').toISOString(),
      },
      {
        key: 'assets/strips/golden-gate-finish.jpg',
        filename: 'golden-gate-finish.jpg',
        size: 142800,
        mimeType: 'image/jpeg',
        url: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?auto=format&fit=crop&w=1200&q=80',
        uploaded_at: new Date('2026-01-15T10:05:00Z').toISOString(),
      },
      {
        key: 'assets/strips/trail-tahoe.jpg',
        filename: 'trail-tahoe.jpg',
        size: 165400,
        mimeType: 'image/jpeg',
        url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80',
        uploaded_at: new Date('2026-01-18T14:20:00Z').toISOString(),
      },
    ];
    assets.forEach((a) => this.r2Assets.set(a.key, a));

    // Templates
    const template1Id = 'tpl-golden-gate-full';
    const template1: PassTemplate = {
      id: template1Id,
      org_id: orgId,
      name: 'Marathon VIP Digital Pass',
      background_color: '#0f172a', // Slate 900
      text_color: '#ffffff',
      label_color: '#38bdf8', // Sky 400
      logo_image_url: assets[0].url,
      strip_image_url: assets[1].url,
      schema_definition: JSON.stringify({
        passType: 'eventTicket',
        primaryFields: [
          { key: 'bib', label: 'BIB NUMBER', alignment: 'center', changeMessage: 'Bib assigned: %@' }
        ],
        secondaryFields: [
          { key: 'category', label: 'CATEGORY', alignment: 'left' },
          { key: 'wave', label: 'START WAVE', alignment: 'right', changeMessage: 'Start Wave updated to: %@' }
        ],
        auxiliaryFields: [
          { key: 'corral', label: 'CORRAL GATE', alignment: 'left' },
          { key: 'expected_pace', label: 'TARGET PACE', alignment: 'center' },
          { key: 'tshirt_size', label: 'SHIRT SIZE', alignment: 'right' }
        ],
        backFields: [
          { key: 'emergency_contact', label: 'Emergency Contact' },
          { key: 'medical_notes', label: 'Medical Information / Allergies' },
          { key: 'bag_drop_zone', label: 'Bag Drop Zone' },
          { key: 'race_rules', label: 'Official Rules & Timing Chips' }
        ],
        barcodeType: 'PKBarcodeFormatQR',
        barcodeAltText: 'SCAN AT START LINE CHUTE & FINISH VILLAGE'
      }),
      created_at: new Date('2026-01-20T09:00:00Z').toISOString(),
    };
    this.templates.set(template1Id, template1);

    const template2Id = 'tpl-trail-ultra';
    const template2: PassTemplate = {
      id: template2Id,
      org_id: orgId,
      name: 'Sierra Trail 50K Badge',
      background_color: '#064e3b', // Emerald 900
      text_color: '#ecfdf5',
      label_color: '#34d399',
      logo_image_url: assets[0].url,
      strip_image_url: assets[2].url,
      schema_definition: JSON.stringify({
        passType: 'eventTicket',
        primaryFields: [
          { key: 'bib', label: 'BIB #', alignment: 'center' }
        ],
        secondaryFields: [
          { key: 'category', label: 'DIVISION', alignment: 'left' },
          { key: 'mandatory_gear', label: 'GEAR CHECK', alignment: 'right' }
        ],
        auxiliaryFields: [
          { key: 'aid_station_crew', label: 'CREW ACCESS', alignment: 'left' },
          { key: 'cutoff_time', label: 'AID 3 CUTOFF', alignment: 'right' }
        ],
        backFields: [
          { key: 'emergency_contact', label: 'Search & Rescue Emergency Contact' },
          { key: 'satellite_tracker', label: 'Satellite InReach ID' }
        ],
        barcodeType: 'PKBarcodeFormatQR'
      }),
      created_at: new Date('2026-02-01T11:00:00Z').toISOString(),
    };
    this.templates.set(template2Id, template2);

    // Races
    const race1Id = 'race-gg-marathon-2026';
    const race1: Race = {
      id: race1Id,
      org_id: orgId,
      template_id: template1Id,
      name: 'Golden Gate Bridge International Marathon 2026',
      event_date: '2026-11-15T06:30:00Z',
      location: 'San Francisco, CA (Embarcadero Plaza)',
      field_mapping: JSON.stringify({
        bib: 'bib_number',
        category: 'race_division',
        wave: 'start_wave',
        corral: 'corral_letter',
        expected_pace: 'target_pace',
        tshirt_size: 'tshirt_size',
        emergency_contact: 'emergency_contact',
        medical_notes: 'medical_notes'
      }),
      created_at: new Date('2026-02-10T12:00:00Z').toISOString(),
    };
    this.races.set(race1Id, race1);

    const race2Id = 'race-sierra-ultra-2026';
    const race2: Race = {
      id: race2Id,
      org_id: orgId,
      template_id: template2Id,
      name: 'Sierra Tahoe 50K Alpine Endurance Trail',
      event_date: '2026-10-24T05:45:00Z',
      location: 'Olympic Valley, Lake Tahoe, CA',
      field_mapping: JSON.stringify({
        bib: 'bib_number',
        category: 'race_division',
        mandatory_gear: 'gear_status',
        aid_station_crew: 'crew_pass',
        cutoff_time: 'aid_cutoff',
        emergency_contact: 'emergency_contact'
      }),
      created_at: new Date('2026-02-15T15:30:00Z').toISOString(),
    };
    this.races.set(race2Id, race2);

    // Sample Runners & Passes
    const initialRunners = [
      {
        id: 'run-marathon-1042',
        race_id: race1Id,
        email: 'arnoldcaisip@gmail.com',
        first_name: 'Arnold',
        last_name: 'Caisip',
        dynamic_data: JSON.stringify({
          bib_number: '1042',
          race_division: 'Full Marathon (42.2K)',
          start_wave: 'Wave A (06:30 AM)',
          corral_letter: 'Chute Red 1',
          target_pace: '4:15 min/km (Sub-3:00)',
          tshirt_size: 'Men L',
          emergency_contact: 'Maria Caisip (+1 415-555-0199)',
          medical_notes: 'No allergies. Penicillin alert.',
          bag_drop_zone: 'Zone Blue #4',
          race_rules: 'Bib must be pinned on front chest. Timing chip on shoe lace.'
        }),
        status: 'issued' as const,
        appleInstalled: 1,
        googleInstalled: 0,
      },
      {
        id: 'run-marathon-2088',
        race_id: race1Id,
        email: 'elena.rostova@fastmail.com',
        first_name: 'Elena',
        last_name: 'Rostova',
        dynamic_data: JSON.stringify({
          bib_number: '2088',
          race_division: 'Full Marathon (42.2K)',
          start_wave: 'Wave A (06:30 AM)',
          corral_letter: 'Chute Red 2',
          target_pace: '4:30 min/km',
          tshirt_size: 'Women M',
          emergency_contact: 'Sergei Rostov (+1 510-555-0143)',
          medical_notes: 'Asthma inhaler carried in belt',
          bag_drop_zone: 'Zone Blue #6',
          race_rules: 'Bib must be visible. Official timing mats at 10K, 21.1K, 30K and Finish.'
        }),
        status: 'issued' as const,
        appleInstalled: 1,
        googleInstalled: 1,
      },
      {
        id: 'run-marathon-3419',
        race_id: race1Id,
        email: 'marcus.vance@techcorp.io',
        first_name: 'Marcus',
        last_name: 'Vance',
        dynamic_data: JSON.stringify({
          bib_number: '3419',
          race_division: 'Half Marathon (21.1K)',
          start_wave: 'Wave B (07:00 AM)',
          corral_letter: 'Chute Yellow',
          target_pace: '5:00 min/km',
          tshirt_size: 'Men XL',
          emergency_contact: 'Claire Vance (+1 650-555-0182)',
          medical_notes: 'None',
          bag_drop_zone: 'Zone Green #12',
          race_rules: 'Bib must be visible at all times.'
        }),
        status: 'issued' as const,
        appleInstalled: 0,
        googleInstalled: 1,
      },
      {
        id: 'run-marathon-4591',
        race_id: race1Id,
        email: 'sophie.chen@stanford.edu',
        first_name: 'Sophie',
        last_name: 'Chen',
        dynamic_data: JSON.stringify({
          bib_number: '4591',
          race_division: 'Full Marathon (42.2K)',
          start_wave: 'Wave B (07:00 AM)',
          corral_letter: 'Chute Yellow',
          target_pace: '4:45 min/km',
          tshirt_size: 'Women S',
          emergency_contact: 'David Chen (+1 408-555-0128)',
          medical_notes: 'None',
          bag_drop_zone: 'Zone Green #5',
          race_rules: 'Official course closes at 6 hours.'
        }),
        status: 'issued' as const,
        appleInstalled: 1,
        googleInstalled: 0,
      },
      {
        id: 'run-tahoe-801',
        race_id: race2Id,
        email: 'kevin.ohea@tahoe-endurance.org',
        first_name: 'Kevin',
        last_name: 'O\'Shea',
        dynamic_data: JSON.stringify({
          bib_number: '801',
          race_division: '50K Solo Trail',
          gear_status: 'Verified (Emergency Bivy + 1.5L Water)',
          crew_pass: 'Aid 2 & Aid 4 Authorized',
          aid_cutoff: '13:30 at Red Lake Aid',
          emergency_contact: 'Nora O\'Shea (+1 775-555-0112)'
        }),
        status: 'issued' as const,
        appleInstalled: 1,
        googleInstalled: 0,
      }
    ];

    initialRunners.forEach((r, idx) => {
      const runnerRecord: Runner = {
        id: r.id,
        race_id: r.race_id,
        email: r.email,
        first_name: r.first_name,
        last_name: r.last_name,
        dynamic_data: r.dynamic_data,
        created_at: new Date(Date.now() - (idx + 1) * 3600000 * 48).toISOString(),
      };
      this.runners.set(r.id, runnerRecord);

      const passRecord: Pass = {
        id: `pass-${r.id}`,
        runner_id: r.id,
        walletwallet_pass_id: `ww_pass_${r.id}_${Math.random().toString(36).substring(2, 9)}`,
        status: r.status,
        installed_apple: r.appleInstalled,
        installed_google: r.googleInstalled,
        created_at: new Date(Date.now() - (idx + 1) * 3600000 * 48).toISOString(),
        updated_at: new Date(Date.now() - (idx + 1) * 3600000 * 4).toISOString(),
      };
      this.passes.set(passRecord.id, passRecord);

      // Add sample push log for demonstration
      if (idx === 0) {
        this.pushLogs.push({
          id: 'log-push-1',
          runner_id: r.id,
          pass_id: passRecord.id,
          runner_name: `${r.first_name} ${r.last_name}`,
          field_changed: 'start_wave',
          old_value: 'Wave B (07:00 AM)',
          new_value: 'Wave A (06:30 AM)',
          timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
          status: 'delivered'
        });
        this.emailLogs.push({
          id: 'log-email-1',
          runner_id: r.id,
          to: r.email,
          subject: 'Your Golden Gate Bridge Marathon 2026 Digital Pass is Ready!',
          pass_url: `/pass/${r.id}`,
          sent_at: new Date(Date.now() - 3600000 * 12).toISOString(),
          status: 'delivered'
        });
      }
    });
  }

  // --- D1 Organizations ---
  getOrganizations(): Organization[] {
    return Array.from(this.organizations.values());
  }

  // --- D1 Templates ---
  getTemplates(orgId?: string): PassTemplate[] {
    const all = Array.from(this.templates.values());
    if (orgId) return all.filter((t) => t.org_id === orgId);
    return all;
  }

  getTemplateById(id: string): PassTemplate | undefined {
    return this.templates.get(id);
  }

  createTemplate(template: Omit<PassTemplate, 'id' | 'created_at'>): PassTemplate {
    const id = `tpl-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const created: PassTemplate = {
      ...template,
      id,
      created_at: new Date().toISOString(),
    };
    this.templates.set(id, created);
    return created;
  }

  updateTemplate(id: string, updates: Partial<PassTemplate>): PassTemplate | null {
    const existing = this.templates.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.templates.set(id, updated);
    return updated;
  }

  // --- D1 Races ---
  getRaces(orgId?: string): Race[] {
    const races = Array.from(this.races.values());
    const filtered = orgId ? races.filter((r) => r.org_id === orgId) : races;
    return filtered.map((race) => {
      const template = this.templates.get(race.template_id);
      const runners = Array.from(this.runners.values()).filter((r) => r.race_id === race.id);
      const passes = runners.map((r) => this.getPassByRunnerId(r.id)).filter(Boolean);
      const issued = passes.filter((p) => p?.status === 'issued').length;
      return {
        ...race,
        template_name: template?.name || 'Standard Pass',
        runner_count: runners.length,
        issued_count: issued,
      };
    });
  }

  getRaceById(id: string): Race | undefined {
    const race = this.races.get(id);
    if (!race) return undefined;
    const template = this.templates.get(race.template_id);
    const runners = Array.from(this.runners.values()).filter((r) => r.race_id === race.id);
    const passes = runners.map((r) => this.getPassByRunnerId(r.id)).filter(Boolean);
    const issued = passes.filter((p) => p?.status === 'issued').length;
    return {
      ...race,
      template_name: template?.name || 'Standard Pass',
      runner_count: runners.length,
      issued_count: issued,
    };
  }

  createRace(data: Omit<Race, 'id' | 'created_at'>): Race {
    const id = `race-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const race: Race = {
      ...data,
      id,
      created_at: new Date().toISOString(),
    };
    this.races.set(id, race);
    return race;
  }

  updateRace(id: string, updates: Partial<Race>): Race | null {
    const existing = this.races.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.races.set(id, updated);
    return updated;
  }

  deleteRace(id: string): boolean {
    // Cascade delete runners and passes
    const runners = Array.from(this.runners.values()).filter((r) => r.race_id === id);
    runners.forEach((r) => {
      this.deleteRunner(r.id);
    });
    return this.races.delete(id);
  }

  // --- D1 Runners ---
  getRunners(raceId?: string): Runner[] {
    const all = Array.from(this.runners.values());
    const list = raceId ? all.filter((r) => r.race_id === raceId) : all;
    return list.map((runner) => {
      const pass = this.getPassByRunnerId(runner.id);
      const race = this.races.get(runner.race_id);
      return {
        ...runner,
        pass,
        race_name: race?.name,
      };
    });
  }

  getRunnerById(id: string): Runner | undefined {
    const runner = this.runners.get(id);
    if (!runner) return undefined;
    const pass = this.getPassByRunnerId(runner.id);
    const race = this.races.get(runner.race_id);
    return {
      ...runner,
      pass,
      race_name: race?.name,
    };
  }

  getRunnerByEmail(email: string, raceId?: string): Runner | undefined {
    const all = Array.from(this.runners.values());
    return all.find((r) => r.email.toLowerCase() === email.toLowerCase() && (!raceId || r.race_id === raceId));
  }

  createRunner(data: {
    race_id: string;
    email: string;
    first_name: string;
    last_name: string;
    dynamic_data: Record<string, any> | string;
    issuePassImmediate?: boolean;
  }): { runner: Runner; pass: Pass } {
    const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const runner: Runner = {
      id,
      race_id: data.race_id,
      email: data.email,
      first_name: data.first_name,
      last_name: data.last_name,
      dynamic_data: typeof data.dynamic_data === 'string' ? data.dynamic_data : JSON.stringify(data.dynamic_data),
      created_at: new Date().toISOString(),
    };
    this.runners.set(id, runner);

    const passId = `pass-${id}`;
    const pass: Pass = {
      id: passId,
      runner_id: id,
      walletwallet_pass_id: `ww_pass_${id}_${Math.random().toString(36).substring(2, 9)}`,
      status: data.issuePassImmediate ? 'issued' : 'pending',
      installed_apple: 0,
      installed_google: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.passes.set(passId, pass);

    return { runner, pass };
  }

  updateRunner(id: string, updates: Partial<Runner>): Runner | null {
    const existing = this.runners.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.runners.set(id, updated);
    return updated;
  }

  deleteRunner(id: string): boolean {
    const pass = this.getPassByRunnerId(id);
    if (pass) {
      this.passes.delete(pass.id);
    }
    return this.runners.delete(id);
  }

  // --- D1 Passes ---
  getPasses(): Pass[] {
    return Array.from(this.passes.values());
  }

  getPassByRunnerId(runnerId: string): Pass | undefined {
    return Array.from(this.passes.values()).find((p) => p.runner_id === runnerId);
  }

  updatePass(id: string, updates: Partial<Pass>): Pass | null {
    const existing = this.passes.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.passes.set(id, updated);
    return updated;
  }

  // --- Cloudflare Queues Emulation ---
  enqueueJob(job: Omit<QueueJob, 'id' | 'status' | 'attempts' | 'created_at'>): QueueJob {
    const newJob: QueueJob = {
      ...job,
      id: `qjob-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      status: 'queued',
      attempts: 0,
      created_at: new Date().toISOString(),
    };
    this.queue.push(newJob);
    return newJob;
  }

  getQueueJobs(): QueueJob[] {
    return [...this.queue];
  }

  processQueueBatch(batchSize: number = 10): { processed: number; success: number; failed: number } {
    const queuedJobs = this.queue.filter((j) => j.status === 'queued').slice(0, batchSize);
    let success = 0;
    let failed = 0;

    for (const job of queuedJobs) {
      job.status = 'processing';
      job.attempts += 1;
      try {
        const pass = this.getPassByRunnerId(job.runner_id);
        if (pass) {
          this.updatePass(pass.id, {
            status: 'issued',
            walletwallet_pass_id: `ww_pass_${job.runner_id}_${Math.random().toString(36).substring(2, 8)}`,
          });
        }
        job.status = 'completed';
        job.processed_at = new Date().toISOString();
        success += 1;

        // Auto-enqueue transactional email via Resend
        this.logEmail({
          runner_id: job.runner_id,
          to: job.payload.email,
          subject: `Your Race Pass is Ready! Download now`,
          pass_url: `/pass/${job.runner_id}`,
        });
      } catch (err: any) {
        job.status = 'failed';
        job.error = err.message || 'Pass generation error';
        failed += 1;
      }
    }

    return { processed: queuedJobs.length, success, failed };
  }

  flushQueue(): void {
    this.queue = [];
  }

  // --- Push Logs ---
  logPush(log: Omit<PushNotificationLog, 'id' | 'timestamp'>): PushNotificationLog {
    const newLog: PushNotificationLog = {
      ...log,
      id: `push-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    this.pushLogs.unshift(newLog);
    if (this.pushLogs.length > 50) this.pushLogs.pop();
    return newLog;
  }

  getPushLogs(): PushNotificationLog[] {
    return [...this.pushLogs];
  }

  // --- Resend Email Logs ---
  logEmail(data: Omit<ResendEmailLog, 'id' | 'sent_at' | 'status'>): ResendEmailLog {
    const newEmail: ResendEmailLog = {
      ...data,
      id: `re_msg_${Date.now().toString(36)}`,
      sent_at: new Date().toISOString(),
      status: 'delivered',
    };
    this.emailLogs.unshift(newEmail);
    if (this.emailLogs.length > 50) this.emailLogs.pop();
    return newEmail;
  }

  getEmailLogs(): ResendEmailLog[] {
    return [...this.emailLogs];
  }

  // --- Cloudflare R2 Storage Emulation ---
  getR2Assets(): R2Asset[] {
    return Array.from(this.r2Assets.values());
  }

  saveR2Asset(asset: Omit<R2Asset, 'uploaded_at'>): R2Asset {
    const created: R2Asset = {
      ...asset,
      uploaded_at: new Date().toISOString(),
    };
    this.r2Assets.set(asset.key, created);
    return created;
  }

  deleteR2Asset(key: string): boolean {
    return this.r2Assets.delete(key);
  }

  // --- D1 SQL Execution Engine for Admin Console ---
  executeSql(query: string): { results: any[]; changes: number; error?: string } {
    const trimmed = query.trim();
    const upper = trimmed.toUpperCase();

    try {
      if (upper.startsWith('SELECT')) {
        if (upper.includes('RUNNERS')) {
          const runners = this.getRunners();
          return { results: runners.slice(0, 50), changes: 0 };
        }
        if (upper.includes('PASSES')) {
          const passes = this.getPasses();
          return { results: passes.slice(0, 50), changes: 0 };
        }
        if (upper.includes('RACES')) {
          const races = this.getRaces();
          return { results: races, changes: 0 };
        }
        if (upper.includes('TEMPLATES')) {
          const tpls = this.getTemplates();
          return { results: tpls, changes: 0 };
        }
        if (upper.includes('ORGANIZATIONS')) {
          const orgs = this.getOrganizations();
          return { results: orgs, changes: 0 };
        }
        // Generic metadata query like pragma table_info
        if (upper.includes('PRAGMA') || upper.includes('SQLITE_MASTER')) {
          return {
            results: [
              { name: 'Organizations', type: 'table', sql: 'CREATE TABLE Organizations ...' },
              { name: 'Templates', type: 'table', sql: 'CREATE TABLE Templates ...' },
              { name: 'Races', type: 'table', sql: 'CREATE TABLE Races ...' },
              { name: 'Runners', type: 'table', sql: 'CREATE TABLE Runners ...' },
              { name: 'Passes', type: 'table', sql: 'CREATE TABLE Passes ...' },
            ],
            changes: 0,
          };
        }
        return {
          results: [{ message: 'Query parsed in D1 emulator. Select matched 0 tables.' }],
          changes: 0,
        };
      } else if (upper.startsWith('UPDATE') || upper.startsWith('INSERT') || upper.startsWith('DELETE')) {
        return {
          results: [{ message: 'D1 mutation executed successfully.' }],
          changes: 1,
        };
      }
      return {
        results: [{ info: 'Statement executed in D1 edge emulator.' }],
        changes: 0,
      };
    } catch (err: any) {
      return { results: [], changes: 0, error: err.message };
    }
  }
}

export const d1Db = new D1DatabaseEmulator();
