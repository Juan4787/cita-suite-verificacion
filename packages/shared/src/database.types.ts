export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_grants: {
        Row: {
          admin_email: string | null
          admin_id: string | null
          amount: number | null
          business_id: string
          created_at: string
          duration_seconds: number | null
          duration_unit: string | null
          enabled_after: boolean | null
          enabled_before: boolean | null
          grace_until_after: string | null
          grace_until_before: string | null
          id: string
          idempotency_key: string
          is_permanent_after: boolean | null
          is_permanent_before: boolean | null
          is_permanent_grant: boolean
          note: string | null
          operation: string
          paid_until_after: string | null
          paid_until_before: string | null
          restricted_until_after: string | null
          restricted_until_before: string | null
          source: string
          status_after: string | null
          status_before: string | null
        }
        Insert: {
          admin_email?: string | null
          admin_id?: string | null
          amount?: number | null
          business_id: string
          created_at?: string
          duration_seconds?: number | null
          duration_unit?: string | null
          enabled_after?: boolean | null
          enabled_before?: boolean | null
          grace_until_after?: string | null
          grace_until_before?: string | null
          id?: string
          idempotency_key: string
          is_permanent_after?: boolean | null
          is_permanent_before?: boolean | null
          is_permanent_grant?: boolean
          note?: string | null
          operation: string
          paid_until_after?: string | null
          paid_until_before?: string | null
          restricted_until_after?: string | null
          restricted_until_before?: string | null
          source?: string
          status_after?: string | null
          status_before?: string | null
        }
        Update: {
          admin_email?: string | null
          admin_id?: string | null
          amount?: number | null
          business_id?: string
          created_at?: string
          duration_seconds?: number | null
          duration_unit?: string | null
          enabled_after?: boolean | null
          enabled_before?: boolean | null
          grace_until_after?: string | null
          grace_until_before?: string | null
          id?: string
          idempotency_key?: string
          is_permanent_after?: boolean | null
          is_permanent_before?: boolean | null
          is_permanent_grant?: boolean
          note?: string | null
          operation?: string
          paid_until_after?: string | null
          paid_until_before?: string | null
          restricted_until_after?: string | null
          restricted_until_before?: string | null
          source?: string
          status_after?: string | null
          status_before?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_grants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      account_assistance_grants: {
        Row: {
          business_id: string
          created_at: string
          dismissed_at: string | null
          dismissed_by_user_id: string | null
          expires_at: string
          id: string
          requested_by_user_id: string
          revoked_at: string | null
          revoked_by_user_id: string | null
          starts_at: string
          status: string
          support_user_id: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          dismissed_at?: string | null
          dismissed_by_user_id?: string | null
          expires_at: string
          id?: string
          requested_by_user_id: string
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          starts_at?: string
          status?: string
          support_user_id: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          dismissed_at?: string | null
          dismissed_by_user_id?: string | null
          expires_at?: string
          id?: string
          requested_by_user_id?: string
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          starts_at?: string
          status?: string
          support_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_assistance_grants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      account_assistance_support_users: {
        Row: {
          created_at: string
          email: string
          enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      allowed_emails: {
        Row: {
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_reason: string | null
          email: string
          enabled: boolean
          id: string
          note: string | null
          onboarding_mode: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          email: string
          enabled?: boolean
          id?: string
          note?: string | null
          onboarding_mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          email?: string
          enabled?: boolean
          id?: string
          note?: string | null
          onboarding_mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      appointment_booking_contexts: {
        Row: {
          appointment_id: string
          business_id: string
          context_fingerprint: string
          contract_version: number
          created_at: string
          entry_point: string
          integration_id: string
          integration_revision: number
          modality: string
          theme_snapshot: string
          video_instructions_snapshot: string | null
        }
        Insert: {
          appointment_id: string
          business_id: string
          context_fingerprint: string
          contract_version: number
          created_at?: string
          entry_point: string
          integration_id: string
          integration_revision: number
          modality: string
          theme_snapshot: string
          video_instructions_snapshot?: string | null
        }
        Update: {
          appointment_id?: string
          business_id?: string
          context_fingerprint?: string
          contract_version?: number
          created_at?: string
          entry_point?: string
          integration_id?: string
          integration_revision?: number
          modality?: string
          theme_snapshot?: string
          video_instructions_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_booking_contexts_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "appointment_booking_contexts_business_id_integration_id_fkey"
            columns: ["business_id", "integration_id"]
            isOneToOne: false
            referencedRelation: "booking_integrations"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      appointment_google_calendar_events: {
        Row: {
          appointment_id: string
          attempt_count: number
          business_id: string
          calendar_id: string
          claimed_at: string | null
          connection_id: string
          created_at: string
          event_id: string | null
          id: string
          last_attempt_at: string | null
          last_error_at: string | null
          last_error_code: string | null
          last_synced_at: string | null
          next_attempt_at: string
          sync_status: string
          synced_sequence: number
          updated_at: string
        }
        Insert: {
          appointment_id: string
          attempt_count?: number
          business_id: string
          calendar_id?: string
          claimed_at?: string | null
          connection_id: string
          created_at?: string
          event_id?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error_at?: string | null
          last_error_code?: string | null
          last_synced_at?: string | null
          next_attempt_at?: string
          sync_status?: string
          synced_sequence?: number
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          attempt_count?: number
          business_id?: string
          calendar_id?: string
          claimed_at?: string | null
          connection_id?: string
          created_at?: string
          event_id?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error_at?: string | null
          last_error_code?: string | null
          last_synced_at?: string | null
          next_attempt_at?: string
          sync_status?: string
          synced_sequence?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_google_calendar_eve_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "appointment_google_calendar_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_google_calendar_events_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "google_calendar_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_intake_responses: {
        Row: {
          answers: Json
          appointment_id: string
          business_id: string
          created_at: string
          free_comment: string | null
          patient_id: string
          schema_snapshot: Json
        }
        Insert: {
          answers: Json
          appointment_id: string
          business_id: string
          created_at?: string
          free_comment?: string | null
          patient_id: string
          schema_snapshot: Json
        }
        Update: {
          answers?: Json
          appointment_id?: string
          business_id?: string
          created_at?: string
          free_comment?: string | null
          patient_id?: string
          schema_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "appointment_intake_responses_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment_booking_contexts"
            referencedColumns: ["business_id", "appointment_id"]
          },
          {
            foreignKeyName: "appointment_intake_responses_business_id_patient_id_fkey"
            columns: ["business_id", "patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      appointment_intake_submissions: {
        Row: {
          answers: Json
          appointment_id: string
          business_id: string
          created_at: string
          free_comment: string | null
          id: string
          patient_id: string
          profile_changes: Json
          request_key: string
          schema_snapshot: Json
          sequence_no: number
        }
        Insert: {
          answers: Json
          appointment_id: string
          business_id: string
          created_at?: string
          free_comment?: string | null
          id?: string
          patient_id: string
          profile_changes?: Json
          request_key: string
          schema_snapshot: Json
          sequence_no?: never
        }
        Update: {
          answers?: Json
          appointment_id?: string
          business_id?: string
          created_at?: string
          free_comment?: string | null
          id?: string
          patient_id?: string
          profile_changes?: Json
          request_key?: string
          schema_snapshot?: Json
          sequence_no?: never
        }
        Relationships: [
          {
            foreignKeyName: "appointment_intake_submissions_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment_patient_information_contexts"
            referencedColumns: ["business_id", "appointment_id"]
          },
          {
            foreignKeyName: "appointment_intake_submissions_business_id_patient_id_fkey"
            columns: ["business_id", "patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      appointment_patient_information_contexts: {
        Row: {
          appointment_id: string
          business_id: string
          created_at: string
          patient_id_snapshot: string
          request_fingerprint: string | null
          schema_snapshot: Json
        }
        Insert: {
          appointment_id: string
          business_id: string
          created_at?: string
          patient_id_snapshot: string
          request_fingerprint?: string | null
          schema_snapshot: Json
        }
        Update: {
          appointment_id?: string
          business_id?: string
          created_at?: string
          patient_id_snapshot?: string
          request_fingerprint?: string | null
          schema_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "appointment_patient_informati_business_id_patient_id_snaps_fkey"
            columns: ["business_id", "patient_id_snapshot"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "appointment_patient_information_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      appointment_professionals: {
        Row: {
          appointment_id: string
          base_blocking_ends_at: string
          base_blocking_starts_at: string
          blocking_ends_at: string
          blocking_starts_at: string
          break_minutes_snapshot: number
          business_id: string
          created_at: string
          ends_at: string
          id: string
          ignore_break: boolean
          is_primary: boolean
          position: number
          professional_id: string
          professional_name_snapshot: string
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          base_blocking_ends_at: string
          base_blocking_starts_at: string
          blocking_ends_at: string
          blocking_starts_at: string
          break_minutes_snapshot?: number
          business_id: string
          created_at?: string
          ends_at: string
          id?: string
          ignore_break?: boolean
          is_primary?: boolean
          position: number
          professional_id: string
          professional_name_snapshot: string
          starts_at: string
          status: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          base_blocking_ends_at?: string
          base_blocking_starts_at?: string
          blocking_ends_at?: string
          blocking_starts_at?: string
          break_minutes_snapshot?: number
          business_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          ignore_break?: boolean
          is_primary?: boolean
          position?: number
          professional_id?: string
          professional_name_snapshot?: string
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_professionals_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "appointment_professionals_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      appointments: {
        Row: {
          blocking_ends_at: string
          blocking_starts_at: string
          break_minutes_snapshot: number
          buffer_after_minutes_snapshot: number
          buffer_before_minutes_snapshot: number
          business_id: string
          calendar_action_at: string | null
          calendar_action_count: number
          calendar_action_status: string
          calendar_offered_at: string | null
          calendar_provider: string | null
          calendar_sequence: number
          calendar_update_required_at: string | null
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          cancelled_reason: string | null
          confirmation_token: string
          confirmed_at: string | null
          created_at: string
          created_by_user_id: string | null
          creation_request_fingerprint: string | null
          creation_request_key: string | null
          duration_minutes_snapshot: number
          ends_at: string
          id: string
          ignore_break: boolean
          internal_note: string | null
          patient_id: string
          patient_instructions_snapshot: string | null
          patient_name_at_booking: string
          patient_phone_e164_at_booking: string | null
          patient_phone_raw_at_booking: string | null
          patient_resolution_strategy: string
          phone_communication_status_at_booking: string
          phone_warning_acknowledged_at: string | null
          price_quote_snapshot: Json | null
          professional_id: string
          professional_name_snapshot: string
          public_booking_contact_key: string | null
          public_reminder_description_snapshot: string | null
          reminder_due_at: string | null
          reschedule_requested_at: string | null
          service_id: string
          service_name_snapshot: string
          source: string
          starts_at: string
          status: string
          updated_at: string
          updated_by_user_id: string | null
          whatsapp_opt_in_at: string | null
          whatsapp_opt_in_source: string | null
          whatsapp_opt_in_text: string | null
          whatsapp_reminder_marked_sent_at: string | null
          whatsapp_reminder_marked_sent_by: string | null
          whatsapp_reminder_opened_at: string | null
          whatsapp_reminder_opened_by: string | null
        }
        Insert: {
          blocking_ends_at: string
          blocking_starts_at: string
          break_minutes_snapshot?: number
          buffer_after_minutes_snapshot?: number
          buffer_before_minutes_snapshot?: number
          business_id: string
          calendar_action_at?: string | null
          calendar_action_count?: number
          calendar_action_status?: string
          calendar_offered_at?: string | null
          calendar_provider?: string | null
          calendar_sequence?: number
          calendar_update_required_at?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          cancelled_reason?: string | null
          confirmation_token?: string
          confirmed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          creation_request_fingerprint?: string | null
          creation_request_key?: string | null
          duration_minutes_snapshot: number
          ends_at: string
          id?: string
          ignore_break?: boolean
          internal_note?: string | null
          patient_id: string
          patient_instructions_snapshot?: string | null
          patient_name_at_booking: string
          patient_phone_e164_at_booking?: string | null
          patient_phone_raw_at_booking?: string | null
          patient_resolution_strategy?: string
          phone_communication_status_at_booking?: string
          phone_warning_acknowledged_at?: string | null
          price_quote_snapshot?: Json | null
          professional_id: string
          professional_name_snapshot: string
          public_booking_contact_key?: string | null
          public_reminder_description_snapshot?: string | null
          reminder_due_at?: string | null
          reschedule_requested_at?: string | null
          service_id: string
          service_name_snapshot: string
          source?: string
          starts_at: string
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
          whatsapp_opt_in_at?: string | null
          whatsapp_opt_in_source?: string | null
          whatsapp_opt_in_text?: string | null
          whatsapp_reminder_marked_sent_at?: string | null
          whatsapp_reminder_marked_sent_by?: string | null
          whatsapp_reminder_opened_at?: string | null
          whatsapp_reminder_opened_by?: string | null
        }
        Update: {
          blocking_ends_at?: string
          blocking_starts_at?: string
          break_minutes_snapshot?: number
          buffer_after_minutes_snapshot?: number
          buffer_before_minutes_snapshot?: number
          business_id?: string
          calendar_action_at?: string | null
          calendar_action_count?: number
          calendar_action_status?: string
          calendar_offered_at?: string | null
          calendar_provider?: string | null
          calendar_sequence?: number
          calendar_update_required_at?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          cancelled_reason?: string | null
          confirmation_token?: string
          confirmed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          creation_request_fingerprint?: string | null
          creation_request_key?: string | null
          duration_minutes_snapshot?: number
          ends_at?: string
          id?: string
          ignore_break?: boolean
          internal_note?: string | null
          patient_id?: string
          patient_instructions_snapshot?: string | null
          patient_name_at_booking?: string
          patient_phone_e164_at_booking?: string | null
          patient_phone_raw_at_booking?: string | null
          patient_resolution_strategy?: string
          phone_communication_status_at_booking?: string
          phone_warning_acknowledged_at?: string | null
          price_quote_snapshot?: Json | null
          professional_id?: string
          professional_name_snapshot?: string
          public_booking_contact_key?: string | null
          public_reminder_description_snapshot?: string | null
          reminder_due_at?: string | null
          reschedule_requested_at?: string | null
          service_id?: string
          service_name_snapshot?: string
          source?: string
          starts_at?: string
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
          whatsapp_opt_in_at?: string | null
          whatsapp_opt_in_source?: string | null
          whatsapp_opt_in_text?: string | null
          whatsapp_reminder_marked_sent_at?: string | null
          whatsapp_reminder_marked_sent_by?: string | null
          whatsapp_reminder_opened_at?: string | null
          whatsapp_reminder_opened_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_business_id_patient_id_fkey"
            columns: ["business_id", "patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "appointments_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "appointments_business_id_service_id_fkey"
            columns: ["business_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          business_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
          reason_code: string | null
          result: string
          user_id: string | null
        }
        Insert: {
          action: string
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
          reason_code?: string | null
          result?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
          reason_code?: string | null
          result?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_exception_batches: {
        Row: {
          business_id: string
          created_at: string
          fingerprint: string
          request_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          fingerprint: string
          request_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          fingerprint?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_exception_batches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_exception_services: {
        Row: {
          business_id: string
          exception_id: string
          service_id: string
        }
        Insert: {
          business_id: string
          exception_id: string
          service_id: string
        }
        Update: {
          business_id?: string
          exception_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_exception_services_business_id_exception_id_fkey"
            columns: ["business_id", "exception_id"]
            isOneToOne: false
            referencedRelation: "availability_exceptions"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "availability_exception_services_business_id_service_id_fkey"
            columns: ["business_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      availability_exceptions: {
        Row: {
          business_id: string
          created_at: string
          ends_at: string
          id: string
          professional_id: string | null
          reason: string | null
          starts_at: string
          type: string
        }
        Insert: {
          business_id: string
          created_at?: string
          ends_at: string
          id?: string
          professional_id?: string | null
          reason?: string | null
          starts_at: string
          type: string
        }
        Update: {
          business_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          professional_id?: string | null
          reason?: string | null
          starts_at?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_exceptions_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      availability_rule_services: {
        Row: {
          business_id: string
          rule_id: string
          service_id: string
        }
        Insert: {
          business_id: string
          rule_id: string
          service_id: string
        }
        Update: {
          business_id?: string
          rule_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_rule_services_business_id_rule_id_fkey"
            columns: ["business_id", "rule_id"]
            isOneToOne: false
            referencedRelation: "availability_rules"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "availability_rule_services_business_id_service_id_fkey"
            columns: ["business_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          break_minutes: number
          business_id: string
          created_at: string
          end_time: string
          id: string
          is_active: boolean
          professional_id: string
          service_scope: string
          slot_interval_minutes: number
          start_time: string
          weekday: number
        }
        Insert: {
          break_minutes?: number
          business_id: string
          created_at?: string
          end_time: string
          id?: string
          is_active?: boolean
          professional_id: string
          service_scope?: string
          slot_interval_minutes?: number
          start_time: string
          weekday: number
        }
        Update: {
          break_minutes?: number
          business_id?: string
          created_at?: string
          end_time?: string
          id?: string
          is_active?: boolean
          professional_id?: string
          service_scope?: string
          slot_interval_minutes?: number
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_rules_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      booking_integrations: {
        Row: {
          allowed_modalities: string[]
          allowed_origins: string[]
          allowed_professional_ids: string[]
          allowed_service_ids: string[]
          business_id: string
          contract_version: number
          created_at: string
          id: string
          intake_schema: Json
          is_active: boolean
          is_default: boolean
          modality_windows: Json
          name: string
          public_key: string
          revision: number
          theme: string
          updated_at: string
          video_instructions: string | null
        }
        Insert: {
          allowed_modalities?: string[]
          allowed_origins?: string[]
          allowed_professional_ids?: string[]
          allowed_service_ids?: string[]
          business_id: string
          contract_version?: number
          created_at?: string
          id?: string
          intake_schema?: Json
          is_active?: boolean
          is_default?: boolean
          modality_windows?: Json
          name: string
          public_key?: string
          revision?: number
          theme?: string
          updated_at?: string
          video_instructions?: string | null
        }
        Update: {
          allowed_modalities?: string[]
          allowed_origins?: string[]
          allowed_professional_ids?: string[]
          allowed_service_ids?: string[]
          business_id?: string
          contract_version?: number
          created_at?: string
          id?: string
          intake_schema?: Json
          is_active?: boolean
          is_default?: boolean
          modality_windows?: Json
          name?: string
          public_key?: string
          revision?: number
          theme?: string
          updated_at?: string
          video_instructions?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_integrations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_data_revisions: {
        Row: {
          business_id: string
          patients_revision: number
          realtime_topic_token: string
          updated_at: string
        }
        Insert: {
          business_id: string
          patients_revision?: number
          realtime_topic_token?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          patients_revision?: number
          realtime_topic_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_data_revisions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_subscriptions: {
        Row: {
          access_note: string | null
          access_source: string
          access_starts_at: string
          archived_at: string | null
          business_id: string
          commercial_access_enabled: boolean
          created_at: string
          expiration_notice_enabled: boolean
          grace_until: string | null
          id: string
          is_permanent: boolean
          last_grant_duration_seconds: number | null
          last_payment_amount: number | null
          last_payment_at: string | null
          paid_until: string | null
          restricted_until: string | null
          subscription_status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          access_note?: string | null
          access_source?: string
          access_starts_at?: string
          archived_at?: string | null
          business_id: string
          commercial_access_enabled?: boolean
          created_at?: string
          expiration_notice_enabled?: boolean
          grace_until?: string | null
          id?: string
          is_permanent?: boolean
          last_grant_duration_seconds?: number | null
          last_payment_amount?: number | null
          last_payment_at?: string | null
          paid_until?: string | null
          restricted_until?: string | null
          subscription_status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          access_note?: string | null
          access_source?: string
          access_starts_at?: string
          archived_at?: string | null
          business_id?: string
          commercial_access_enabled?: boolean
          created_at?: string
          expiration_notice_enabled?: boolean
          grace_until?: string | null
          id?: string
          is_permanent?: boolean
          last_grant_duration_seconds?: number | null
          last_payment_amount?: number | null
          last_payment_at?: string | null
          paid_until?: string | null
          restricted_until?: string | null
          subscription_status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_user_invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          business_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          professional_id: string | null
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          business_id: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          professional_id?: string | null
          role: string
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          business_id?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          professional_id?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_user_invites_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_user_invites_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "business_user_invites_business_professional_fk"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      business_users: {
        Row: {
          accepted_at: string | null
          business_id: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_reason: string | null
          id: string
          role: string
          status: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          id?: string
          role: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          id?: string
          role?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address: string | null
          address_instructions: string | null
          allow_same_day_booking: boolean
          booking_availability_revision: number
          cancellation_policy: string | null
          created_at: string
          email: string | null
          id: string
          industry: string
          is_active: boolean
          logo_url: string | null
          maps_url: string | null
          max_booking_days_ahead: number
          min_booking_notice_minutes: number
          name: string
          patient_documents_enabled: boolean
          phone: string | null
          public_booking_enabled: boolean
          public_contact_enabled: boolean
          slug: string
          timezone: string
          updated_at: string
          whatsapp_contact_enabled: boolean
          whatsapp_enabled: boolean
          whatsapp_message: string | null
          whatsapp_phone: string | null
        }
        Insert: {
          address?: string | null
          address_instructions?: string | null
          allow_same_day_booking?: boolean
          booking_availability_revision?: number
          cancellation_policy?: string | null
          created_at?: string
          email?: string | null
          id?: string
          industry: string
          is_active?: boolean
          logo_url?: string | null
          maps_url?: string | null
          max_booking_days_ahead?: number
          min_booking_notice_minutes?: number
          name: string
          patient_documents_enabled?: boolean
          phone?: string | null
          public_booking_enabled?: boolean
          public_contact_enabled?: boolean
          slug: string
          timezone?: string
          updated_at?: string
          whatsapp_contact_enabled?: boolean
          whatsapp_enabled?: boolean
          whatsapp_message?: string | null
          whatsapp_phone?: string | null
        }
        Update: {
          address?: string | null
          address_instructions?: string | null
          allow_same_day_booking?: boolean
          booking_availability_revision?: number
          cancellation_policy?: string | null
          created_at?: string
          email?: string | null
          id?: string
          industry?: string
          is_active?: boolean
          logo_url?: string | null
          maps_url?: string | null
          max_booking_days_ahead?: number
          min_booking_notice_minutes?: number
          name?: string
          patient_documents_enabled?: boolean
          phone?: string | null
          public_booking_enabled?: boolean
          public_contact_enabled?: boolean
          slug?: string
          timezone?: string
          updated_at?: string
          whatsapp_contact_enabled?: boolean
          whatsapp_enabled?: boolean
          whatsapp_message?: string | null
          whatsapp_phone?: string | null
        }
        Relationships: []
      }
      clinical_entries: {
        Row: {
          amount: number | null
          archived_at: string | null
          business_id: string | null
          created_at: string
          created_by_professional_id: string | null
          created_by_user_id: string | null
          description: string
          entry_type: string
          id: string
          internal_note: string | null
          locked_after: string | null
          owner_id: string | null
          patient_id: string
          teeth: string | null
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          amount?: number | null
          archived_at?: string | null
          business_id?: string | null
          created_at?: string
          created_by_professional_id?: string | null
          created_by_user_id?: string | null
          description: string
          entry_type: string
          id?: string
          internal_note?: string | null
          locked_after?: string | null
          owner_id?: string | null
          patient_id: string
          teeth?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          amount?: number | null
          archived_at?: string | null
          business_id?: string | null
          created_at?: string
          created_by_professional_id?: string | null
          created_by_user_id?: string | null
          description?: string
          entry_type?: string
          id?: string
          internal_note?: string | null
          locked_after?: string | null
          owner_id?: string | null
          patient_id?: string
          teeth?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_entries_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_entry_costs: {
        Row: {
          amount: number | null
          business_id: string
          clinical_entry_id: string
          created_at: string
          created_by: string | null
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount?: number | null
          business_id: string
          clinical_entry_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number | null
          business_id?: string
          clinical_entry_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_entry_costs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_entry_costs_clinical_entry_id_fkey"
            columns: ["clinical_entry_id"]
            isOneToOne: false
            referencedRelation: "clinical_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_storage_budget: {
        Row: {
          max_bytes: number
          reserved_bytes: number
          singleton: boolean
          updated_at: string
          used_bytes: number
        }
        Insert: {
          max_bytes?: number
          reserved_bytes?: number
          singleton?: boolean
          updated_at?: string
          used_bytes: number
        }
        Update: {
          max_bytes?: number
          reserved_bytes?: number
          singleton?: boolean
          updated_at?: string
          used_bytes?: number
        }
        Relationships: []
      }
      clinical_upload_slots: {
        Row: {
          bucket: string
          expires_at: string
          file_id: string
          path: string
          reserved_bytes: number
        }
        Insert: {
          bucket: string
          expires_at: string
          file_id: string
          path: string
          reserved_bytes: number
        }
        Update: {
          bucket?: string
          expires_at?: string
          file_id?: string
          path?: string
          reserved_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "clinical_upload_slots_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "patient_radiographs"
            referencedColumns: ["id"]
          },
        ]
      }
      drive_connections: {
        Row: {
          connected_email: string | null
          created_at: string
          owner_id: string
          provider: string
          root_folder_id: string | null
          updated_at: string
        }
        Insert: {
          connected_email?: string | null
          created_at?: string
          owner_id: string
          provider?: string
          root_folder_id?: string | null
          updated_at?: string
        }
        Update: {
          connected_email?: string | null
          created_at?: string
          owner_id?: string
          provider?: string
          root_folder_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      follow_ups: {
        Row: {
          assigned_professional_id: string | null
          business_id: string
          created_at: string
          created_by: string | null
          done_at: string | null
          id: string
          message: string | null
          patient_id: string
          remind_on: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_professional_id?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          id?: string
          message?: string | null
          patient_id: string
          remind_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_professional_id?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          id?: string
          message?: string | null
          patient_id?: string
          remind_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_assigned_professional_id_fkey"
            columns: ["assigned_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_connections: {
        Row: {
          created_at: string
          google_subject: string
          granted_scopes: string[]
          id: string
          last_error_code: string | null
          last_refresh_at: string | null
          oauth_client_key: string
          refresh_token_ciphertext: string | null
          revoked_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          google_subject: string
          granted_scopes?: string[]
          id?: string
          last_error_code?: string | null
          last_refresh_at?: string | null
          oauth_client_key: string
          refresh_token_ciphertext?: string | null
          revoked_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          google_subject?: string
          granted_scopes?: string[]
          id?: string
          last_error_code?: string | null
          last_refresh_at?: string | null
          oauth_client_key?: string
          refresh_token_ciphertext?: string | null
          revoked_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      google_calendar_oauth_attempts: {
        Row: {
          appointment_id: string
          business_id: string
          code_verifier_ciphertext: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          force_consent: boolean
          id: string
          state_hash: string
        }
        Insert: {
          appointment_id: string
          business_id: string
          code_verifier_ciphertext: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          force_consent?: boolean
          id?: string
          state_hash: string
        }
        Update: {
          appointment_id?: string
          business_id?: string
          code_verifier_ciphertext?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          force_consent?: boolean
          id?: string
          state_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_oauth_attempts_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "google_calendar_oauth_attempts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      google_review_patient_delivery_state: {
        Row: {
          active_request_id: string | null
          business_id: string
          claim_expires_at: string | null
          created_at: string
          last_sent_at: string | null
          patient_id: string
          updated_at: string
        }
        Insert: {
          active_request_id?: string | null
          business_id: string
          claim_expires_at?: string | null
          created_at?: string
          last_sent_at?: string | null
          patient_id: string
          updated_at?: string
        }
        Update: {
          active_request_id?: string | null
          business_id?: string
          claim_expires_at?: string | null
          created_at?: string
          last_sent_at?: string | null
          patient_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_review_patient_delivery_stat_business_id_patient_id_fkey"
            columns: ["business_id", "patient_id"]
            isOneToOne: true
            referencedRelation: "patients"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      google_review_requests: {
        Row: {
          appointment_ends_at: string
          appointment_id: string
          attempt_count: number
          business_id: string
          claim_expires_at: string | null
          claim_token: string | null
          claimed_at: string | null
          click_token_hash: string | null
          clicked_at: string | null
          created_at: string
          id: string
          last_error_kind: string | null
          next_attempt_at: string | null
          notification_action_label_snapshot: string | null
          notification_body_snapshot: string | null
          notification_title_snapshot: string | null
          patient_id: string
          prepared_at: string | null
          push_delivery_id: string | null
          push_service_status: number | null
          push_subscription_id: string | null
          review_url_snapshot: string | null
          scheduled_for: string
          sent_at: string | null
          status: string
          status_reason: string | null
          updated_at: string
        }
        Insert: {
          appointment_ends_at: string
          appointment_id: string
          attempt_count?: number
          business_id: string
          claim_expires_at?: string | null
          claim_token?: string | null
          claimed_at?: string | null
          click_token_hash?: string | null
          clicked_at?: string | null
          created_at?: string
          id?: string
          last_error_kind?: string | null
          next_attempt_at?: string | null
          notification_action_label_snapshot?: string | null
          notification_body_snapshot?: string | null
          notification_title_snapshot?: string | null
          patient_id: string
          prepared_at?: string | null
          push_delivery_id?: string | null
          push_service_status?: number | null
          push_subscription_id?: string | null
          review_url_snapshot?: string | null
          scheduled_for: string
          sent_at?: string | null
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Update: {
          appointment_ends_at?: string
          appointment_id?: string
          attempt_count?: number
          business_id?: string
          claim_expires_at?: string | null
          claim_token?: string | null
          claimed_at?: string | null
          click_token_hash?: string | null
          clicked_at?: string | null
          created_at?: string
          id?: string
          last_error_kind?: string | null
          next_attempt_at?: string | null
          notification_action_label_snapshot?: string | null
          notification_body_snapshot?: string | null
          notification_title_snapshot?: string | null
          patient_id?: string
          prepared_at?: string | null
          push_delivery_id?: string | null
          push_service_status?: number | null
          push_subscription_id?: string | null
          review_url_snapshot?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_review_requests_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "google_review_requests_business_id_patient_id_fkey"
            columns: ["business_id", "patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "google_review_requests_push_delivery_id_fkey"
            columns: ["push_delivery_id"]
            isOneToOne: false
            referencedRelation: "push_delivery_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_review_requests_push_subscription_id_fkey"
            columns: ["push_subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      google_review_settings: {
        Row: {
          business_id: string
          created_at: string
          enabled: boolean
          notification_action_label: string
          notification_body: string
          notification_title: string
          review_url: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          enabled?: boolean
          notification_action_label?: string
          notification_body?: string
          notification_title?: string
          review_url?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          enabled?: boolean
          notification_action_label?: string
          notification_body?: string
          notification_title?: string
          review_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_review_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_messages: {
        Row: {
          business_id: string
          created_at: string
          from_phone_e164: string
          id: string
          messaging_account_id: string | null
          provider: string
          provider_message_id: string
          raw_payload: Json | null
          received_at: string
          requires_human: boolean
          text: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          from_phone_e164: string
          id?: string
          messaging_account_id?: string | null
          provider?: string
          provider_message_id: string
          raw_payload?: Json | null
          received_at?: string
          requires_human?: boolean
          text?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          from_phone_e164?: string
          id?: string
          messaging_account_id?: string | null
          provider?: string
          provider_message_id?: string
          raw_payload?: Json | null
          received_at?: string
          requires_human?: boolean
          text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_messages_business_id_messaging_account_id_fkey"
            columns: ["business_id", "messaging_account_id"]
            isOneToOne: false
            referencedRelation: "messaging_accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      message_dispatches: {
        Row: {
          appointment_id: string | null
          attempts: number
          business_id: string
          cancelled_at: string | null
          channel: string
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          human_error_message: string | null
          id: string
          last_error_code: string | null
          last_error_message: string | null
          max_attempts: number
          message_body: string | null
          messaging_account_id: string | null
          metadata: Json | null
          patient_id: string | null
          provider: string
          provider_message_id: string | null
          queued_at: string | null
          raw_request: Json | null
          raw_response: Json | null
          read_at: string | null
          scheduled_for: string | null
          sending_at: string | null
          sent_at: string | null
          skipped_at: string | null
          status: string
          superseded_at: string | null
          superseded_reason: string | null
          template_id: string | null
          template_variables: Json
          to_phone_e164: string
          type: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          attempts?: number
          business_id: string
          cancelled_at?: string | null
          channel?: string
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          human_error_message?: string | null
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          max_attempts?: number
          message_body?: string | null
          messaging_account_id?: string | null
          metadata?: Json | null
          patient_id?: string | null
          provider?: string
          provider_message_id?: string | null
          queued_at?: string | null
          raw_request?: Json | null
          raw_response?: Json | null
          read_at?: string | null
          scheduled_for?: string | null
          sending_at?: string | null
          sent_at?: string | null
          skipped_at?: string | null
          status?: string
          superseded_at?: string | null
          superseded_reason?: string | null
          template_id?: string | null
          template_variables?: Json
          to_phone_e164: string
          type: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          attempts?: number
          business_id?: string
          cancelled_at?: string | null
          channel?: string
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          human_error_message?: string | null
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          max_attempts?: number
          message_body?: string | null
          messaging_account_id?: string | null
          metadata?: Json | null
          patient_id?: string | null
          provider?: string
          provider_message_id?: string | null
          queued_at?: string | null
          raw_request?: Json | null
          raw_response?: Json | null
          read_at?: string | null
          scheduled_for?: string | null
          sending_at?: string | null
          sent_at?: string | null
          skipped_at?: string | null
          status?: string
          superseded_at?: string | null
          superseded_reason?: string | null
          template_id?: string | null
          template_variables?: Json
          to_phone_e164?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_dispatches_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "message_dispatches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_dispatches_business_id_messaging_account_id_fkey"
            columns: ["business_id", "messaging_account_id"]
            isOneToOne: false
            referencedRelation: "messaging_accounts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "message_dispatches_business_id_patient_id_fkey"
            columns: ["business_id", "patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "message_dispatches_business_id_template_id_fkey"
            columns: ["business_id", "template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          business_id: string
          category: string
          created_at: string
          id: string
          language: string
          name: string
          provider: string
          provider_template_id: string | null
          rejection_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          body: string
          business_id: string
          category: string
          created_at?: string
          id?: string
          language?: string
          name: string
          provider?: string
          provider_template_id?: string | null
          rejection_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          body?: string
          business_id?: string
          category?: string
          created_at?: string
          id?: string
          language?: string
          name?: string
          provider?: string
          provider_template_id?: string | null
          rejection_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      messaging_accounts: {
        Row: {
          access_token_secret_name: string | null
          bot_enabled: boolean
          business_id: string
          created_at: string
          display_name: string | null
          id: string
          last_error: string | null
          phone_number: string | null
          phone_number_id: string | null
          provider: string
          reminders_enabled: boolean
          status: string
          updated_at: string
          waba_id: string | null
        }
        Insert: {
          access_token_secret_name?: string | null
          bot_enabled?: boolean
          business_id: string
          created_at?: string
          display_name?: string | null
          id?: string
          last_error?: string | null
          phone_number?: string | null
          phone_number_id?: string | null
          provider?: string
          reminders_enabled?: boolean
          status?: string
          updated_at?: string
          waba_id?: string | null
        }
        Update: {
          access_token_secret_name?: string | null
          bot_enabled?: boolean
          business_id?: string
          created_at?: string
          display_name?: string | null
          id?: string
          last_error?: string | null
          phone_number?: string | null
          phone_number_id?: string | null
          provider?: string
          reminders_enabled?: boolean
          status?: string
          updated_at?: string
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messaging_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_subscriptions: {
        Row: {
          business_id: string
          created_at: string
          currency_id: string | null
          id: string
          last_synced_at: string
          next_charge_at: string | null
          payer_email: string | null
          preapproval_id: string
          raw: Json | null
          status: string
          transaction_amount: number | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          currency_id?: string | null
          id?: string
          last_synced_at?: string
          next_charge_at?: string | null
          payer_email?: string | null
          preapproval_id: string
          raw?: Json | null
          status?: string
          transaction_amount?: number | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          currency_id?: string | null
          id?: string
          last_synced_at?: string
          next_charge_at?: string | null
          payer_email?: string | null
          preapproval_id?: string
          raw?: Json | null
          status?: string
          transaction_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mp_subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_webhook_events: {
        Row: {
          action: string | null
          business_id: string | null
          credited_grant_id: string | null
          id: string
          live_mode: boolean | null
          processing_detail: string | null
          processing_status: string
          raw: Json | null
          received_at: string
          request_id: string | null
          requires_attention: boolean
          resource_id: string | null
          signature_valid: boolean
          topic: string | null
        }
        Insert: {
          action?: string | null
          business_id?: string | null
          credited_grant_id?: string | null
          id?: string
          live_mode?: boolean | null
          processing_detail?: string | null
          processing_status?: string
          raw?: Json | null
          received_at?: string
          request_id?: string | null
          requires_attention?: boolean
          resource_id?: string | null
          signature_valid?: boolean
          topic?: string | null
        }
        Update: {
          action?: string | null
          business_id?: string | null
          credited_grant_id?: string | null
          id?: string
          live_mode?: boolean | null
          processing_detail?: string | null
          processing_status?: string
          raw?: Json | null
          received_at?: string
          request_id?: string | null
          requires_attention?: boolean
          resource_id?: string | null
          signature_valid?: boolean
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mp_webhook_events_credited_grant_id_fkey"
            columns: ["credited_grant_id"]
            isOneToOne: false
            referencedRelation: "access_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_clinical_profiles: {
        Row: {
          allergies: string | null
          background: string | null
          business_id: string
          clinical_alert_note: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json | null
          id: string
          medication: string | null
          notes: string | null
          patient_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allergies?: string | null
          background?: string | null
          business_id: string
          clinical_alert_note?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json | null
          id?: string
          medication?: string | null
          notes?: string | null
          patient_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allergies?: string | null
          background?: string | null
          business_id?: string
          clinical_alert_note?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json | null
          id?: string
          medication?: string | null
          notes?: string | null
          patient_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_clinical_profiles_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_clinical_profiles_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_export_sessions: {
        Row: {
          business_id: string
          created_at: string
          dataset_fingerprint: string
          expected_counts: Json
          expires_at: string
          failure_code: string | null
          finished_at: string | null
          id: string
          last_accessed_at: string
          patient_id: string | null
          request_key: string
          requested_by_user_id: string
          schema_version: string
          scope: string
          status: string
          validated_at: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          dataset_fingerprint: string
          expected_counts: Json
          expires_at: string
          failure_code?: string | null
          finished_at?: string | null
          id?: string
          last_accessed_at?: string
          patient_id?: string | null
          request_key: string
          requested_by_user_id: string
          schema_version?: string
          scope: string
          status?: string
          validated_at?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          dataset_fingerprint?: string
          expected_counts?: Json
          expires_at?: string
          failure_code?: string | null
          finished_at?: string | null
          id?: string
          last_accessed_at?: string
          patient_id?: string | null
          request_key?: string
          requested_by_user_id?: string
          schema_version?: string
          scope?: string
          status?: string
          validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_export_sessions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_profile_change_events: {
        Row: {
          business_id: string
          changed_by_name: string
          changed_by_professional_id: string | null
          changed_by_user_id: string | null
          changed_fields: Json
          created_at: string
          id: string
          patient_id: string
          summary: string
        }
        Insert: {
          business_id: string
          changed_by_name: string
          changed_by_professional_id?: string | null
          changed_by_user_id?: string | null
          changed_fields?: Json
          created_at?: string
          id?: string
          patient_id: string
          summary: string
        }
        Update: {
          business_id?: string
          changed_by_name?: string
          changed_by_professional_id?: string | null
          changed_by_user_id?: string | null
          changed_fields?: Json
          created_at?: string
          id?: string
          patient_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_profile_change_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_profile_change_events_changed_by_professional_id_fkey"
            columns: ["changed_by_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_profile_change_events_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_radiographs: {
        Row: {
          appointment_id: string | null
          business_id: string
          bytes: number | null
          client_request_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          drive_file_id: string | null
          failure_code: string | null
          id: string
          integrity_status: string
          mime_type: string | null
          note: string | null
          original_filename: string | null
          owner_id: string | null
          patient_id: string
          ready_at: string | null
          restored_at: string | null
          restored_by: string | null
          sha256: string | null
          source: string
          status: string
          storage_bucket: string | null
          storage_path: string | null
          storage_provider: string
          taken_at: string | null
          thumbnail_path: string | null
          uploaded_by: string | null
        }
        Insert: {
          appointment_id?: string | null
          business_id: string
          bytes?: number | null
          client_request_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          drive_file_id?: string | null
          failure_code?: string | null
          id?: string
          integrity_status?: string
          mime_type?: string | null
          note?: string | null
          original_filename?: string | null
          owner_id?: string | null
          patient_id: string
          ready_at?: string | null
          restored_at?: string | null
          restored_by?: string | null
          sha256?: string | null
          source?: string
          status?: string
          storage_bucket?: string | null
          storage_path?: string | null
          storage_provider?: string
          taken_at?: string | null
          thumbnail_path?: string | null
          uploaded_by?: string | null
        }
        Update: {
          appointment_id?: string | null
          business_id?: string
          bytes?: number | null
          client_request_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          drive_file_id?: string | null
          failure_code?: string | null
          id?: string
          integrity_status?: string
          mime_type?: string | null
          note?: string | null
          original_filename?: string | null
          owner_id?: string | null
          patient_id?: string
          ready_at?: string | null
          restored_at?: string | null
          restored_by?: string | null
          sha256?: string | null
          source?: string
          status?: string
          storage_bucket?: string | null
          storage_path?: string | null
          storage_provider?: string
          taken_at?: string | null
          thumbnail_path?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_document_appointment_tenant"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "patient_radiographs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_radiographs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          activity_at: string
          address: string | null
          allergies: string | null
          archived_at: string | null
          background: string | null
          birth_date: string | null
          blocked: boolean
          business_id: string | null
          created_at: string
          custom_fields: Json | null
          dni: string | null
          drive_folder_id: string | null
          email: string | null
          full_name: string
          id: string
          insurance: string | null
          insurance_plan: string | null
          last_entry_at: string | null
          medication: string | null
          notes: string | null
          owner_id: string | null
          phone: string | null
          phone_e164: string | null
          phone_raw: string | null
          search_dni_digits: string
          search_name_normalized: string
          search_phone_digits: string
          spam_score: number
          updated_at: string
        }
        Insert: {
          activity_at?: string
          address?: string | null
          allergies?: string | null
          archived_at?: string | null
          background?: string | null
          birth_date?: string | null
          blocked?: boolean
          business_id?: string | null
          created_at?: string
          custom_fields?: Json | null
          dni?: string | null
          drive_folder_id?: string | null
          email?: string | null
          full_name: string
          id?: string
          insurance?: string | null
          insurance_plan?: string | null
          last_entry_at?: string | null
          medication?: string | null
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          phone_e164?: string | null
          phone_raw?: string | null
          search_dni_digits?: string
          search_name_normalized?: string
          search_phone_digits?: string
          spam_score?: number
          updated_at?: string
        }
        Update: {
          activity_at?: string
          address?: string | null
          allergies?: string | null
          archived_at?: string | null
          background?: string | null
          birth_date?: string | null
          blocked?: boolean
          business_id?: string | null
          created_at?: string
          custom_fields?: Json | null
          dni?: string | null
          drive_folder_id?: string | null
          email?: string | null
          full_name?: string
          id?: string
          insurance?: string | null
          insurance_plan?: string | null
          last_entry_at?: string | null
          medication?: string | null
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          phone_e164?: string | null
          phone_raw?: string | null
          search_dni_digits?: string
          search_name_normalized?: string
          search_phone_digits?: string
          spam_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_booking_forms: {
        Row: {
          business_id: string
          fields: Json
          professional_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          business_id: string
          fields?: Json
          professional_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          fields?: Json
          professional_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_booking_forms_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      professional_patient_links: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          business_id: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          id: string
          is_active: boolean
          patient_id: string
          professional_id: string
          source: string
          source_entity_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          id?: string
          is_active?: boolean
          patient_id: string
          professional_id: string
          source?: string
          source_entity_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          id?: string
          is_active?: boolean
          patient_id?: string
          professional_id?: string
          source?: string
          source_entity_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_patient_links_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_patient_links_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_patient_links_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_services: {
        Row: {
          business_id: string
          created_at: string
          id: string
          professional_id: string
          service_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          professional_id: string
          service_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          professional_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_services_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_services_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "professional_services_business_id_service_id_fkey"
            columns: ["business_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      professional_users: {
        Row: {
          business_id: string
          created_at: string
          id: string
          professional_id: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          professional_id: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          professional_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_users_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      professionals: {
        Row: {
          avatar_url: string | null
          business_id: string
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          is_public: boolean
          name: string
          phone: string | null
          sort_order: number
          specialty: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          business_id: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_public?: boolean
          name: string
          phone?: string | null
          sort_order?: number
          specialty?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          business_id?: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_public?: boolean
          name?: string
          phone?: string | null
          sort_order?: number
          specialty?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professionals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      public_booking_attempts: {
        Row: {
          action: string
          business_id: string | null
          created_at: string
          error_code: string | null
          id: string
          ip_hash: string | null
          metadata: Json | null
          phone_e164: string | null
          success: boolean
          user_agent: string | null
        }
        Insert: {
          action: string
          business_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          ip_hash?: string | null
          metadata?: Json | null
          phone_e164?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Update: {
          action?: string
          business_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          ip_hash?: string | null
          metadata?: Json | null
          phone_e164?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "public_booking_attempts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      push_delivery_attempts: {
        Row: {
          accepted_at: string | null
          appointment_id: string
          business_id: string
          clicked_at: string | null
          created_at: string
          displayed_at: string | null
          expires_at: string
          failed_at: string | null
          failure_kind: string | null
          google_review_request_id: string | null
          id: string
          kind: string
          push_service_status: number | null
          receipt_token_hash: string
          received_at: string | null
          request_key_hash: string | null
          subscription_id: string
          superseded_at: string | null
          updated_at: string
          user_confirmed_at: string | null
          user_reported_missing_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          appointment_id: string
          business_id: string
          clicked_at?: string | null
          created_at?: string
          displayed_at?: string | null
          expires_at: string
          failed_at?: string | null
          failure_kind?: string | null
          google_review_request_id?: string | null
          id?: string
          kind: string
          push_service_status?: number | null
          receipt_token_hash: string
          received_at?: string | null
          request_key_hash?: string | null
          subscription_id: string
          superseded_at?: string | null
          updated_at?: string
          user_confirmed_at?: string | null
          user_reported_missing_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          appointment_id?: string
          business_id?: string
          clicked_at?: string | null
          created_at?: string
          displayed_at?: string | null
          expires_at?: string
          failed_at?: string | null
          failure_kind?: string | null
          google_review_request_id?: string | null
          id?: string
          kind?: string
          push_service_status?: number | null
          receipt_token_hash?: string
          received_at?: string | null
          request_key_hash?: string | null
          subscription_id?: string
          superseded_at?: string | null
          updated_at?: string
          user_confirmed_at?: string | null
          user_reported_missing_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_delivery_attempts_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "push_delivery_attempts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_delivery_attempts_google_review_request_id_fkey"
            columns: ["google_review_request_id"]
            isOneToOne: false
            referencedRelation: "google_review_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_delivery_attempts_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      push_devices: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_notification_clicked_at: string | null
          last_seen_at: string
          last_test_confirmed_at: string | null
          p256dh: string
          provider_gone_at: string | null
          updated_at: string
          user_agent: string | null
          verification_required_at: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_notification_clicked_at?: string | null
          last_seen_at?: string
          last_test_confirmed_at?: string | null
          p256dh: string
          provider_gone_at?: string | null
          updated_at?: string
          user_agent?: string | null
          verification_required_at?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_notification_clicked_at?: string | null
          last_seen_at?: string
          last_test_confirmed_at?: string | null
          p256dh?: string
          provider_gone_at?: string | null
          updated_at?: string
          user_agent?: string | null
          verification_required_at?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          appointment_id: string
          business_id: string
          created_at: string
          detached_at: string | null
          detached_reason: string | null
          device_id: string
          failed_count: number
          id: string
          push_24h_claimed_at: string | null
          push_24h_sent_at: string | null
          push_2h_claimed_at: string | null
          push_2h_sent_at: string | null
          updated_at: string
        }
        Insert: {
          appointment_id: string
          business_id: string
          created_at?: string
          detached_at?: string | null
          detached_reason?: string | null
          device_id: string
          failed_count?: number
          id?: string
          push_24h_claimed_at?: string | null
          push_24h_sent_at?: string | null
          push_2h_claimed_at?: string | null
          push_2h_sent_at?: string | null
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          business_id?: string
          created_at?: string
          detached_at?: string | null
          detached_reason?: string | null
          device_id?: string
          failed_count?: number
          id?: string
          push_24h_claimed_at?: string | null
          push_24h_sent_at?: string | null
          push_2h_claimed_at?: string | null
          push_2h_sent_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "push_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      server_rate_limit_events: {
        Row: {
          action: string
          created_at: string
          id: string
          subject_hash: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          subject_hash: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          subject_hash?: string
        }
        Relationships: []
      }
      service_price_monthly_adjustments: {
        Row: {
          business_id: string
          kind: string
          month: string
          percentage: number
          policy_id: string
        }
        Insert: {
          business_id: string
          kind: string
          month: string
          percentage: number
          policy_id: string
        }
        Update: {
          business_id?: string
          kind?: string
          month?: string
          percentage?: number
          policy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_price_monthly_adjustments_business_id_policy_id_fkey"
            columns: ["business_id", "policy_id"]
            isOneToOne: false
            referencedRelation: "service_price_policies"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      service_price_policies: {
        Row: {
          base_amount: number
          base_month: string
          business_id: string
          currency: string
          first_adjustment_month: string
          id: string
          monthly_percentage: number
          professional_id: string | null
          revision: number
          rounding_unit: number
          service_id: string
          updated_at: string
        }
        Insert: {
          base_amount: number
          base_month: string
          business_id: string
          currency?: string
          first_adjustment_month: string
          id?: string
          monthly_percentage: number
          professional_id?: string | null
          revision?: number
          rounding_unit?: number
          service_id: string
          updated_at?: string
        }
        Update: {
          base_amount?: number
          base_month?: string
          business_id?: string
          currency?: string
          first_adjustment_month?: string
          id?: string
          monthly_percentage?: number
          professional_id?: string | null
          revision?: number
          rounding_unit?: number
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_price_policies_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "service_price_policies_business_id_service_id_fkey"
            columns: ["business_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      service_price_policy_versions: {
        Row: {
          business_id: string
          configuration: Json
          created_at: string
          created_by: string | null
          policy_id: string
          revision: number
        }
        Insert: {
          business_id: string
          configuration: Json
          created_at?: string
          created_by?: string | null
          policy_id: string
          revision: number
        }
        Update: {
          business_id?: string
          configuration?: Json
          created_at?: string
          created_by?: string | null
          policy_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_price_policy_versions_business_id_policy_id_fkey"
            columns: ["business_id", "policy_id"]
            isOneToOne: false
            referencedRelation: "service_price_policies"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      services: {
        Row: {
          buffer_after_minutes: number
          buffer_before_minutes: number
          business_id: string
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          is_public: boolean
          name: string
          patient_instructions: string | null
          price_label: string | null
          public_reminder_description: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          business_id: string
          created_at?: string
          description?: string | null
          duration_minutes: number
          id?: string
          is_active?: boolean
          is_public?: boolean
          name: string
          patient_instructions?: string | null
          price_label?: string | null
          public_reminder_description?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          business_id?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          is_public?: boolean
          name?: string
          patient_instructions?: string | null
          price_label?: string | null
          public_reminder_description?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_webhook_events: {
        Row: {
          business_id: string | null
          created_at: string
          event_type: string
          id: string
          messaging_account_id: string | null
          payload: Json
          processed: boolean
          processed_at: string | null
          processing_error: string | null
          provider: string
          provider_event_id: string | null
          received_at: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          messaging_account_id?: string | null
          payload: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_event_id?: string | null
          received_at?: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          messaging_account_id?: string | null
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_event_id?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_webhook_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_webhook_events_business_id_messaging_account_id_fkey"
            columns: ["business_id", "messaging_account_id"]
            isOneToOne: false
            referencedRelation: "messaging_accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accessible_patient_counts: {
        Args: { p_business_id: string }
        Returns: {
          active_count: number
          archived_count: number
          total_count: number
        }[]
      }
      activate_account_assistance: {
        Args: { target_business_id: string; target_support_user_id: string }
        Returns: {
          business_id: string
          created_at: string
          dismissed_at: string
          expires_at: string
          id: string
          requested_by_user_id: string
          revoked_at: string
          starts_at: string
          status: string
          support_user_id: string
          updated_at: string
        }[]
      }
      add_business_user_by_email: {
        Args: {
          target_business_id: string
          target_email: string
          target_role: string
        }
        Returns: string
      }
      assert_email_available_for_business: {
        Args: { target_business_id: string; target_email: string }
        Returns: undefined
      }
      audit_security_event: {
        Args: {
          p_action: string
          p_business_id: string
          p_entity_id: string
          p_entity_type: string
          p_metadata?: Json
          p_reason_code: string
          p_result: string
          p_user_id: string
        }
        Returns: undefined
      }
      authorize_google_calendar_event: {
        Args: {
          p_appointment_id: string
          p_google_subject: string
          p_granted_scopes: string[]
          p_now?: string
          p_oauth_client_key: string
          p_refresh_token_ciphertext: string
        }
        Returns: {
          connection_row_id: string
          event_row_id: string
        }[]
      }
      begin_patient_export: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_patient_id: string
          p_request_key: string
          p_scope: string
        }
        Returns: Json
      }
      begin_patient_radiograph_upload: {
        Args: {
          p_actor_id: string
          p_business_id: string
          p_bytes: number
          p_client_request_id: string
          p_mime_type: string
          p_note?: string
          p_original_filename: string
          p_patient_id: string
          p_sha256: string
          p_taken_at?: string
        }
        Returns: {
          created_at: string
          radiograph_id: string
          status: string
          storage_bucket: string
          storage_path: string
          thumbnail_path: string
        }[]
      }
      begin_public_patient_document_upload: {
        Args: {
          p_bytes: number
          p_filename: string
          p_mime: string
          p_note?: string
          p_request_id: string
          p_sha256: string
          p_token: string
        }
        Returns: {
          appointment_id: string | null
          business_id: string
          bytes: number | null
          client_request_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          drive_file_id: string | null
          failure_code: string | null
          id: string
          integrity_status: string
          mime_type: string | null
          note: string | null
          original_filename: string | null
          owner_id: string | null
          patient_id: string
          ready_at: string | null
          restored_at: string | null
          restored_by: string | null
          sha256: string | null
          source: string
          status: string
          storage_bucket: string | null
          storage_path: string | null
          storage_provider: string
          taken_at: string | null
          thumbnail_path: string | null
          uploaded_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "patient_radiographs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      business_allows_operation: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      business_allows_owner_restricted_read: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      cancel_business_role_invite: {
        Args: { target_invite_id: string }
        Returns: undefined
      }
      cancel_patient_export: {
        Args: { p_actor_user_id: string; p_export_id: string }
        Returns: Json
      }
      claim_due_google_review_requests: {
        Args: { claim_limit?: number; claim_now: string }
        Returns: {
          appointment_ends_at: string
          appointment_id: string
          auth: string
          business_id: string
          claim_token: string
          confirmation_token: string
          endpoint: string
          p256dh: string
          patient_id: string
          request_id: string
          scheduled_for: string
          subscription_id: string
        }[]
      }
      claim_due_push_reminders: {
        Args: { claim_limit?: number; claim_now: string }
        Returns: {
          appointment_id: string
          auth: string
          business_id: string
          endpoint: string
          p256dh: string
          reminder_kind: string
          subscription_id: string
        }[]
      }
      claim_expired_clinical_uploads: {
        Args: { p_actor_id: string; p_business_id: string }
        Returns: Json
      }
      claim_google_calendar_sync_jobs: {
        Args: { claim_limit?: number; claim_now: string }
        Returns: {
          event_row_id: string
        }[]
      }
      claim_queued_message_dispatches: {
        Args: { claim_limit?: number; claim_now?: string }
        Returns: {
          appointment_id: string | null
          attempts: number
          business_id: string
          cancelled_at: string | null
          channel: string
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          human_error_message: string | null
          id: string
          last_error_code: string | null
          last_error_message: string | null
          max_attempts: number
          message_body: string | null
          messaging_account_id: string | null
          metadata: Json | null
          patient_id: string | null
          provider: string
          provider_message_id: string | null
          queued_at: string | null
          raw_request: Json | null
          raw_response: Json | null
          read_at: string | null
          scheduled_for: string | null
          sending_at: string | null
          sent_at: string | null
          skipped_at: string | null
          status: string
          superseded_at: string | null
          superseded_reason: string | null
          template_id: string | null
          template_variables: Json
          to_phone_e164: string
          type: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "message_dispatches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clear_patient_drive_folders_safely: {
        Args: { p_business_id: string }
        Returns: undefined
      }
      complete_google_calendar_event_delete: {
        Args: { p_event_row_id: string; p_now?: string }
        Returns: string
      }
      complete_google_calendar_event_sync: {
        Args: {
          p_event_row_id: string
          p_google_event_id: string
          p_now?: string
          p_synced_sequence: number
        }
        Returns: string
      }
      complete_google_review_request: {
        Args: {
          complete_time?: string
          target_claim_token: string
          target_push_delivery_id: string
          target_push_service_status: number
          target_request_id: string
        }
        Returns: boolean
      }
      complete_patient_radiograph_upload: {
        Args: {
          p_actor_id: string
          p_actual_bytes: number
          p_actual_mime_type: string
          p_business_id: string
          p_patient_id: string
          p_radiograph_id: string
          p_thumbnail_uploaded?: boolean
        }
        Returns: string
      }
      complete_public_patient_document_upload: {
        Args: {
          p_bytes: number
          p_file_id: string
          p_mime: string
          p_token: string
        }
        Returns: string
      }
      compute_business_subscription_status: {
        Args: {
          p_archived_at: string
          p_commercial_access_enabled: boolean
          p_grace_until: string
          p_is_permanent: boolean
          p_paid_until: string
          p_restricted_until: string
        }
        Returns: string
      }
      consume_booking_integration_read_limit: {
        Args: { p_subject_hash: string }
        Returns: boolean
      }
      consume_google_calendar_oauth_attempt: {
        Args: { p_now?: string; p_state_hash: string }
        Returns: {
          appointment_id: string
          attempt_id: string
          business_id: string
          code_verifier_ciphertext: string
          force_consent: boolean
        }[]
      }
      consume_server_rate_limit: {
        Args: {
          p_action: string
          p_limit: number
          p_subject_hash: string
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
          used: number
        }[]
      }
      consume_server_rate_limits: {
        Args: { p_action: string; p_subject_hash: string; p_windows: Json }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
          used: number
        }[]
      }
      count_active_business_owners: {
        Args: { target_business_id: string }
        Returns: number
      }
      create_appointment_with_patient_identity: {
        Args: {
          p_business_id: string
          p_created_by_user_id: string
          p_idempotency_key: string
          p_ignore_break: boolean
          p_internal_note: string
          p_owner_id: string
          p_patient_email: string
          p_patient_id: string
          p_patient_mode: string
          p_patient_name: string
          p_patient_phone_e164: string
          p_patient_phone_raw: string
          p_phone_communication_status: string
          p_phone_warning_acknowledged: boolean
          p_professional_ids: string[]
          p_replay_only?: boolean
          p_service_id: string
          p_source: string
          p_starts_at: string
          p_update_existing_phone: boolean
        }
        Returns: {
          confirmation_token: string
          ends_at: string
          id: string
          idempotent_replay: boolean
          patient_created: boolean
          patient_id: string
          patient_resolution_strategy: string
          professional_name_snapshot: string
          service_name_snapshot: string
          starts_at: string
        }[]
      }
      create_appointment_with_patient_identity_before_pricing: {
        Args: {
          p_business_id: string
          p_created_by_user_id: string
          p_idempotency_key: string
          p_ignore_break: boolean
          p_internal_note: string
          p_owner_id: string
          p_patient_email: string
          p_patient_id: string
          p_patient_mode: string
          p_patient_name: string
          p_patient_phone_e164: string
          p_patient_phone_raw: string
          p_phone_communication_status: string
          p_phone_warning_acknowledged: boolean
          p_professional_ids: string[]
          p_replay_only?: boolean
          p_service_id: string
          p_source: string
          p_starts_at: string
          p_update_existing_phone: boolean
        }
        Returns: {
          confirmation_token: string
          ends_at: string
          id: string
          idempotent_replay: boolean
          patient_created: boolean
          patient_id: string
          patient_resolution_strategy: string
          professional_name_snapshot: string
          service_name_snapshot: string
          starts_at: string
        }[]
      }
      create_availability_exception_batch: {
        Args: {
          p_ack_existing?: boolean
          p_business_id: string
          p_expected_revision: number
          p_items: Json
          p_request_id: string
        }
        Returns: Json
      }
      create_clinical_entry_safely: {
        Args: {
          p_amount?: number
          p_business_id: string
          p_created_at?: string
          p_description: string
          p_entry_type: string
          p_internal_note?: string
          p_patient_id: string
          p_teeth?: string
        }
        Returns: string
      }
      create_clinical_entry_with_result_safely: {
        Args: {
          p_amount?: number
          p_business_id: string
          p_created_at?: string
          p_description: string
          p_entry_type: string
          p_internal_note?: string
          p_patient_id: string
          p_teeth?: string
        }
        Returns: Json
      }
      create_integrated_public_appointment: {
        Args: {
          p_entry_point?: string
          p_expected_availability_revision: number
          p_idempotency_key: string
          p_intake_answers: Json
          p_integration_id: string
          p_integration_revision: number
          p_internal_note: string
          p_modality: string
          p_patient_email: string
          p_patient_name: string
          p_patient_phone_e164: string
          p_patient_phone_raw: string
          p_phone_communication_status: string
          p_professional_ids: string[]
          p_replay_only?: boolean
          p_service_id: string
          p_starts_at: string
        }
        Returns: {
          confirmation_token: string
          ends_at: string
          id: string
          idempotent_replay: boolean
          patient_created: boolean
          patient_id: string
          patient_resolution_strategy: string
          professional_name_snapshot: string
          service_name_snapshot: string
          starts_at: string
        }[]
      }
      create_joint_appointment: {
        Args: {
          p_business_id: string
          p_created_by_user_id?: string
          p_ignore_break?: boolean
          p_internal_note?: string
          p_patient_id: string
          p_professional_ids: string[]
          p_service_id: string
          p_starts_at: string
        }
        Returns: {
          confirmation_token: string
          ends_at: string
          id: string
          professional_name_snapshot: string
          service_name_snapshot: string
          starts_at: string
        }[]
      }
      create_joint_appointment_with_phone_decision: {
        Args: {
          p_business_id: string
          p_created_by_user_id: string
          p_ignore_break: boolean
          p_internal_note: string
          p_patient_id: string
          p_phone_communication_status: string
          p_phone_warning_acknowledged: boolean
          p_professional_ids: string[]
          p_service_id: string
          p_source: string
          p_starts_at: string
        }
        Returns: {
          confirmation_token: string
          ends_at: string
          id: string
          professional_name_snapshot: string
          service_name_snapshot: string
          starts_at: string
        }[]
      }
      create_joint_appointment_with_source: {
        Args: {
          p_business_id: string
          p_created_by_user_id: string
          p_ignore_break: boolean
          p_internal_note: string
          p_patient_id: string
          p_professional_ids: string[]
          p_service_id: string
          p_source: string
          p_starts_at: string
        }
        Returns: {
          confirmation_token: string
          ends_at: string
          id: string
          professional_name_snapshot: string
          service_name_snapshot: string
          starts_at: string
        }[]
      }
      create_or_restore_professional_patient_link: {
        Args: {
          p_business_id: string
          p_created_by?: string
          p_patient_id: string
          p_professional_id: string
          p_source: string
          p_source_entity_id?: string
        }
        Returns: string
      }
      create_public_booking_with_information: {
        Args: { p_input: Json; p_replay_only?: boolean }
        Returns: {
          confirmation_token: string
          ends_at: string
          id: string
          idempotent_replay: boolean
          patient_created: boolean
          patient_id: string
          patient_resolution_strategy: string
          professional_name_snapshot: string
          service_name_snapshot: string
          starts_at: string
        }[]
      }
      current_user_professional_id: {
        Args: { target_business_id: string }
        Returns: string
      }
      delete_professional_schedule_rule: {
        Args: {
          p_business_id: string
          p_expected_revision: number
          p_professional_id: string
          p_rule_id: string
        }
        Returns: undefined
      }
      dismiss_account_assistance_notice: {
        Args: { target_business_id: string; target_grant_id: string }
        Returns: undefined
      }
      ensure_user_default_business: {
        Args: { p_industry?: string; p_name?: string }
        Returns: {
          business_id: string
          role: string
        }[]
      }
      fail_google_calendar_event_sync: {
        Args: {
          p_error_code: string
          p_event_row_id: string
          p_failure_category: string
          p_next_attempt_at: string
          p_now?: string
        }
        Returns: string
      }
      fail_patient_radiograph_upload: {
        Args: {
          p_actor_id: string
          p_business_id: string
          p_failure_code?: string
          p_patient_id: string
          p_radiograph_id: string
        }
        Returns: string
      }
      get_availability_snapshot: {
        Args: { p_business_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      get_clinical_file_daily_transfer_estimates: {
        Args: { p_local_day?: string }
        Returns: {
          business_id: string
          estimated_transfer_bytes: number
          local_day: string
          original_access_bytes: number
          original_access_events: number
          threshold_level: string
          upload_bytes: number
          upload_events: number
        }[]
      }
      get_clinical_storage_budget: {
        Args: { p_business_id: string }
        Returns: Json
      }
      get_integrated_public_availability_snapshot: {
        Args: {
          p_business_id: string
          p_professional_ids: string[]
          p_range_end: string
          p_range_start: string
          p_service_id: string
        }
        Returns: Json
      }
      get_patient_data_revision: {
        Args: { p_business_id: string }
        Returns: {
          business_id: string
          can_create_patient: boolean
          patients_revision: number
          realtime_topic: string
          viewer_role: string
        }[]
      }
      get_patient_drive_folder_safely: {
        Args: { p_business_id: string; p_patient_id: string }
        Returns: string
      }
      get_public_booking_active_future_count_for_request: {
        Args: {
          p_business_id: string
          p_now?: string
          p_patient_id: string
          p_patient_name: string
          p_phone_e164: string
        }
        Returns: number
      }
      get_public_booking_catalogue: {
        Args: { p_integration_id: string }
        Returns: Json
      }
      get_public_booking_information: {
        Args: { p_token: string }
        Returns: Json
      }
      get_public_patient_booking_schema: {
        Args: {
          p_business_id: string
          p_integration_id?: string
          p_professional_ids: string[]
          p_request_key?: string
        }
        Returns: Json
      }
      get_public_patient_document_upload: {
        Args: { p_file_id: string; p_token: string }
        Returns: {
          appointment_id: string | null
          business_id: string
          bytes: number | null
          client_request_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          drive_file_id: string | null
          failure_code: string | null
          id: string
          integrity_status: string
          mime_type: string | null
          note: string | null
          original_filename: string | null
          owner_id: string | null
          patient_id: string
          ready_at: string | null
          restored_at: string | null
          restored_by: string | null
          sha256: string | null
          source: string
          status: string
          storage_bucket: string | null
          storage_path: string | null
          storage_provider: string
          taken_at: string | null
          thumbnail_path: string | null
          uploaded_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "patient_radiographs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_public_practice_contact: { Args: { p_key: string }; Returns: Json }
      get_public_service_price_labels: {
        Args: {
          p_business_id: string
          p_professional_ids: string[]
          p_service_ids: string[]
        }
        Returns: Json
      }
      get_public_service_price_quote: {
        Args: {
          p_business_id: string
          p_date: string
          p_professional_ids: string[]
          p_service_id: string
        }
        Returns: Json
      }
      grant_business_access: {
        Args: {
          p_admin_email: string
          p_admin_id: string
          p_amount: number
          p_business_id: string
          p_duration_seconds: number
          p_duration_unit: string
          p_idempotency_key: string
          p_is_permanent: boolean
          p_note: string
          p_operation: string
          p_source: string
        }
        Returns: {
          applied: boolean
          grant_id: string
          paid_until_after: string
          paid_until_before: string
          status_after: string
        }[]
      }
      grant_patient_radiograph_original_access: {
        Args: {
          p_actor_id: string
          p_business_id: string
          p_patient_id: string
          p_radiograph_id: string
        }
        Returns: {
          bytes: number
          mime_type: string
          original_filename: string
          storage_bucket: string
          storage_path: string
        }[]
      }
      grant_patient_radiograph_original_access_legacy: {
        Args: {
          p_actor_id: string
          p_business_id: string
          p_patient_id: string
          p_radiograph_id: string
        }
        Returns: {
          bytes: number
          mime_type: string
          original_filename: string
          storage_bucket: string
          storage_path: string
        }[]
      }
      is_email_enabled: { Args: { p_email: string }; Returns: boolean }
      list_accessible_patients_page: {
        Args: {
          p_business_id: string
          p_cursor_activity_at?: string
          p_cursor_id?: string
          p_cursor_rank?: number
          p_limit?: number
          p_query?: string
          p_show_archived?: boolean
          p_snapshot_at?: string
        }
        Returns: {
          activity_at: string
          archived_at: string
          created_at: string
          dni: string
          full_name: string
          id: string
          last_entry_at: string
          phone: string
          professional_archived_at: string
          search_rank: number
        }[]
      }
      list_business_role_access: {
        Args: { target_business_id: string }
        Returns: {
          business_id: string
          created_at: string
          email: string
          id: string
          professional_id: string
          role: string
          status: string
          user_id: string
        }[]
      }
      list_business_users: {
        Args: { target_business_id: string }
        Returns: {
          business_id: string
          created_at: string
          email: string
          id: string
          role: string
          user_id: string
        }[]
      }
      list_trashed_patient_radiographs_page: {
        Args: {
          p_business_id: string
          p_cursor_deleted_at?: string
          p_cursor_id?: string
          p_limit?: number
          p_query?: string
        }
        Returns: {
          bytes: number
          created_at: string
          deleted_at: string
          deleted_by_label: string
          id: string
          integrity_status: string
          mime_type: string
          original_filename: string
          patient_id: string
          patient_name: string
          taken_at: string
          thumbnail_path: string
        }[]
      }
      list_upcoming_active_appointments_snapshot: {
        Args: { p_business_id: string; p_limit?: number }
        Returns: Json
      }
      list_user_business_contexts: {
        Args: never
        Returns: {
          assistance: Json
          business: Json
          role: string
          subscription: Json
        }[]
      }
      mark_push_device_gone: {
        Args: { gone_time?: string; target_endpoint: string }
        Returns: number
      }
      normalize_patient_search_digits: {
        Args: { p_value: string }
        Returns: string
      }
      normalize_patient_search_text: {
        Args: { p_value: string }
        Returns: string
      }
      normalize_phone_e164: { Args: { value: string }; Returns: string }
      normalized_patient_name: { Args: { value: string }; Returns: string }
      patient_document_in_appointment_scope: {
        Args: {
          p_actor_id: string
          p_appointment_id: string
          p_business_id: string
        }
        Returns: boolean
      }
      patients_counts_by_business: {
        Args: { p_business: string }
        Returns: {
          active_count: number
          archived_count: number
          total_count: number
        }[]
      }
      patients_counts_by_owner: {
        Args: { p_owner: string }
        Returns: {
          active_count: number
          archived_count: number
          total_count: number
        }[]
      }
      prepare_google_review_request_delivery: {
        Args: {
          prepare_time?: string
          target_claim_token: string
          target_click_token_hash: string
          target_request_id: string
          target_subscription_id: string
        }
        Returns: {
          notification_action_label: string
          notification_body: string
          notification_title: string
          review_url: string
        }[]
      }
      professional_break_minutes_at: {
        Args: {
          target_business_id: string
          target_professional_id: string
          target_starts_at: string
        }
        Returns: number
      }
      read_patient_export_page: {
        Args: {
          p_actor_user_id: string
          p_cursor?: Json
          p_dataset: string
          p_export_id: string
          p_limit?: number
        }
        Returns: Json
      }
      reassign_appointment_patient_safely: {
        Args: {
          p_actor_user_id: string
          p_appointment_id: string
          p_business_id: string
          p_new_patient_id: string
          p_reason: string
        }
        Returns: {
          appointment_id: string
          cancelled_dispatches: number
          detached_push_subscriptions: number
          invalidated_calendar_attempts: number
          new_patient_id: string
          old_patient_id: string
          queued_calendar_deletions: number
          superseded_dispatches: number
          superseded_push_attempts: number
        }[]
      }
      record_calendar_action: {
        Args: { p_action: string; p_appointment_id: string; p_provider: string }
        Returns: undefined
      }
      record_google_review_click: {
        Args: { click_time?: string; target_click_token_hash: string }
        Returns: {
          review_url: string
        }[]
      }
      record_push_notification_click: {
        Args: {
          click_time?: string
          target_appointment_id: string
          target_delivery_id: string
          target_receipt_token_hash: string
        }
        Returns: boolean
      }
      record_push_test_feedback: {
        Args: {
          feedback_time?: string
          feedback_visible: boolean
          target_appointment_id: string
          target_delivery_id: string
        }
        Returns: boolean
      }
      recover_expired_google_review_request_claims: {
        Args: { recover_time?: string }
        Returns: number
      }
      release_google_review_request: {
        Args: {
          release_time?: string
          target_claim_token: string
          target_error_kind: string
          target_request_id: string
        }
        Returns: boolean
      }
      remove_business_role_access: {
        Args: { target_access_id: string }
        Returns: undefined
      }
      replace_professional_availability_rules: {
        Args: {
          p_business_id: string
          p_professional_id: string
          p_ranges: Json
          p_slot_interval_minutes: number
          p_weekdays: number[]
        }
        Returns: {
          break_minutes: number
          business_id: string
          created_at: string
          end_time: string
          id: string
          is_active: boolean
          professional_id: string
          service_scope: string
          slot_interval_minutes: number
          start_time: string
          weekday: number
        }[]
        SetofOptions: {
          from: "*"
          to: "availability_rules"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      replace_professional_schedule_blocks: {
        Args: {
          p_blocks: Json
          p_business_id: string
          p_expected_revision: number
          p_professional_id: string
        }
        Returns: undefined
      }
      request_google_calendar_event_deletion: {
        Args: { p_appointment_id: string; p_now?: string }
        Returns: string
      }
      restore_patient_radiograph: {
        Args: {
          p_actor_id: string
          p_business_id: string
          p_radiograph_id: string
        }
        Returns: string
      }
      revoke_account_assistance: {
        Args: { target_business_id: string }
        Returns: {
          business_id: string
          created_at: string
          dismissed_at: string
          expires_at: string
          id: string
          requested_by_user_id: string
          revoked_at: string
          starts_at: string
          status: string
          support_user_id: string
          updated_at: string
        }[]
      }
      save_appointment_patient_instructions: {
        Args: {
          p_appointment_id: string
          p_business_id: string
          p_expected_updated_at: string
          p_instructions: string
          p_public_description: string
        }
        Returns: undefined
      }
      save_appointment_push_subscription: {
        Args: {
          save_time?: string
          target_appointment_id: string
          target_auth: string
          target_business_id: string
          target_endpoint: string
          target_p256dh: string
          target_user_agent: string
        }
        Returns: {
          device_id: string
          endpoint: string
          provider_gone: boolean
          subscription_id: string
          test_suppressed: boolean
          verification_confirmed_at: string
        }[]
      }
      save_booking_integration: {
        Args: {
          p_business_id: string
          p_config: Json
          p_expected_revision: number
          p_integration_id: string
        }
        Returns: Json
      }
      save_professional_booking_form: {
        Args: {
          p_business_id: string
          p_expected_revision: number
          p_fields: Json
          p_professional_id: string
        }
        Returns: number
      }
      save_professional_editor: {
        Args: {
          p_ack_existing?: boolean
          p_blocks: Json
          p_business_id: string
          p_exception_items: Json
          p_exception_request_id: string
          p_expected_revision: number
          p_professional_id: string
          p_profile: Json
          p_service_ids: string[]
        }
        Returns: undefined
      }
      save_public_practice_settings: {
        Args: {
          p_business_id: string
          p_expected_updated_at: string
          p_settings: Json
        }
        Returns: undefined
      }
      save_service_patient_instructions: {
        Args: {
          p_business_id: string
          p_expected_updated_at: string
          p_instructions: string
          p_public_description: string
          p_service_id: string
        }
        Returns: undefined
      }
      save_service_price_policy: {
        Args: {
          p_business_id: string
          p_configuration: Json
          p_expected_revision: number
          p_professional_id: string
          p_service_id: string
        }
        Returns: Json
      }
      search_upcoming_active_appointments: {
        Args: { p_business_id: string; p_limit?: number; p_query: string }
        Returns: Json
      }
      set_patient_archive_state_safely: {
        Args: {
          p_archived: boolean
          p_business_id: string
          p_patient_id: string
        }
        Returns: undefined
      }
      set_patient_drive_folder_safely: {
        Args: {
          p_business_id: string
          p_drive_folder_id: string
          p_patient_id: string
        }
        Returns: undefined
      }
      slugify_business_slug: { Args: { value: string }; Returns: string }
      submit_public_booking_information: {
        Args: {
          p_answers: Json
          p_comment: string
          p_expected_version: string
          p_request_key: string
          p_schema_hash: string
          p_token: string
        }
        Returns: string
      }
      trash_patient_radiograph: {
        Args: {
          p_actor_id: string
          p_business_id: string
          p_patient_id: string
          p_radiograph_id: string
        }
        Returns: string
      }
      update_business_role_access: {
        Args: { target_access_id: string; target_role: string }
        Returns: undefined
      }
      update_clinical_entry_safely: {
        Args: {
          p_amount?: number
          p_business_id: string
          p_description: string
          p_entry_id: string
          p_entry_type: string
          p_internal_note?: string
          p_patient_id: string
          p_teeth?: string
        }
        Returns: undefined
      }
      update_patient_with_clinical_profile_safely: {
        Args: {
          p_actor_id: string
          p_address: string
          p_allergies?: string
          p_background?: string
          p_birth_date: string
          p_business_id: string
          p_dni: string
          p_email: string
          p_expected_clinical_profile_updated_at?: string
          p_expected_patient_updated_at?: string
          p_full_name: string
          p_insurance: string
          p_insurance_plan: string
          p_medication?: string
          p_patient_id: string
          p_phone: string
          p_phone_e164: string
          p_phone_raw: string
          p_update_clinical_profile?: boolean
        }
        Returns: {
          clinical_profile_id: string
          clinical_profile_updated_at: string
          patient_id: string
          patient_updated_at: string
        }[]
      }
      upsert_business_role_access: {
        Args: {
          target_business_id: string
          target_email: string
          target_professional_id?: string
          target_role: string
        }
        Returns: {
          invite_id: string
          membership_id: string
          status: string
          user_id: string
        }[]
      }
      upsert_patient_clinical_profile_safely: {
        Args: {
          p_allergies?: string
          p_background?: string
          p_business_id: string
          p_clinical_alert_note?: string
          p_custom_fields?: Json
          p_medication?: string
          p_notes?: string
          p_patient_id: string
        }
        Returns: string
      }
      user_business_role: {
        Args: { target_business_id: string }
        Returns: string
      }
      user_can_configure_business: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      user_can_configure_price: {
        Args: { p_business_id: string; p_professional_id: string }
        Returns: boolean
      }
      user_can_manage_business: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      user_can_manage_users: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      user_can_operate_business: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      user_can_read_appointment: {
        Args: { target_appointment_id: string; target_business_id: string }
        Returns: boolean
      }
      user_can_read_basic_patient: {
        Args: { target_business_id: string; target_patient_id: string }
        Returns: boolean
      }
      user_can_read_clinical_patient: {
        Args: { target_business_id: string; target_patient_id: string }
        Returns: boolean
      }
      user_can_read_patient: {
        Args: { target_business_id: string; target_patient_id: string }
        Returns: boolean
      }
      user_can_read_professional_schedule: {
        Args: { target_business_id: string; target_professional_id: string }
        Returns: boolean
      }
      user_can_read_radiology_reference: {
        Args: { target_business_id: string; target_patient_id: string }
        Returns: boolean
      }
      user_can_view_costs: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      user_has_active_account_assistance: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      user_has_active_professional_patient_link: {
        Args: { target_business_id: string; target_patient_id: string }
        Returns: boolean
      }
      user_has_business_access: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      user_is_professional_for: {
        Args: { target_professional_id: string }
        Returns: boolean
      }
      validate_patient_export: {
        Args: {
          p_actor_user_id: string
          p_export_id: string
          p_received_counts: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
