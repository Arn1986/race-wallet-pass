export interface Organization {
  id: string;
  name: string;
  created_at: string;
}

export interface FieldDefinition {
  key: string;
  label: string;
  valueTemplate?: string; // e.g. "{{bib}}" or "{{category}}"
  alignment?: 'left' | 'center' | 'right';
  changeMessage?: string; // e.g. "Bib assigned: %@ %@"
}

export interface PassSchema {
  passType: 'eventTicket' | 'generic' | 'boardingPass';
  primaryFields: FieldDefinition[];
  secondaryFields: FieldDefinition[];
  auxiliaryFields: FieldDefinition[];
  backFields: FieldDefinition[];
  barcodeType: 'PKBarcodeFormatQR' | 'PKBarcodeFormatPDF417' | 'PKBarcodeFormatCode128';
  barcodeAltText?: string;
  sharingProhibited?: boolean;
}

export interface PassTemplate {
  id: string;
  org_id: string;
  name: string;
  background_color: string;
  text_color: string;
  label_color: string;
  logo_image_url: string;
  background_image_url?: string;
  strip_image_url: string;
  schema_definition: string; // JSON string of PassSchema
  created_at: string;
}

export interface Race {
  id: string;
  org_id: string;
  template_id: string;
  name: string;
  event_date: string;
  location: string;
  field_mapping: string; // JSON mapping CSV columns -> Template fields
  created_at: string;
  // Join fields
  template_name?: string;
  runner_count?: number;
  issued_count?: number;
}

export interface Runner {
  id: string;
  race_id: string;
  email: string;
  first_name: string;
  last_name: string;
  dynamic_data: string; // JSON string of Record<string, any>
  created_at: string;
  // Join fields
  pass?: Pass;
  race_name?: string;
}

export interface Pass {
  id: string;
  runner_id: string;
  walletwallet_pass_id: string;
  google_save_url?: string;
  share_url?: string;
  apple_pass_base64?: string;
  status: 'pending' | 'issued' | 'revoked' | 'failed';
  installed_apple: number; // 0 or 1
  installed_google: number; // 0 or 1
  created_at: string;
  updated_at: string;
}

export interface QueueJob {
  id: string;
  runner_id: string;
  race_id: string;
  payload: {
    first_name: string;
    last_name: string;
    email: string;
    dynamic_data: Record<string, any>;
  };
  status: 'queued' | 'processing' | 'completed' | 'failed';
  attempts: number;
  error?: string;
  created_at: string;
  processed_at?: string;
}

export interface PushNotificationLog {
  id: string;
  runner_id: string;
  pass_id: string;
  runner_name: string;
  field_changed: string;
  old_value: string;
  new_value: string;
  timestamp: string;
  status: 'dispatched' | 'delivered';
}

export interface ResendEmailLog {
  id: string;
  runner_id: string;
  to: string;
  subject: string;
  pass_url: string;
  sent_at: string;
  status: 'delivered' | 'bounced' | 'queued';
}

export interface R2Asset {
  key: string;
  filename: string;
  size: number;
  mimeType: string;
  url: string;
  uploaded_at: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
