export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: { id: string; name: string; slug: string; update_retention_days: number; created_at: string };
        Insert: { id?: string; name: string; slug: string; update_retention_days?: number; created_at?: string };
        Update: { id?: string; name?: string; slug?: string; update_retention_days?: number; created_at?: string };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          organization_id: string;
          role: Database["public"]["Enums"]["app_role"];
          full_name: string;
          email: string;
          phone: string;
          avatar_url: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          organization_id: string;
          role?: Database["public"]["Enums"]["app_role"];
          full_name: string;
          email: string;
          phone?: string;
          avatar_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          full_name?: string;
          email?: string;
          phone?: string;
          avatar_url?: string | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      fields: {
        Row: { id: string; organization_id: string; name: string; is_active: boolean; created_at: string };
        Insert: { id?: string; organization_id: string; name: string; is_active?: boolean; created_at?: string };
        Update: { name?: string; is_active?: boolean };
        Relationships: [];
      };
      herds: {
        Row: { id: string; organization_id: string; name: string; is_active: boolean; created_at: string };
        Insert: { id?: string; organization_id: string; name: string; is_active?: boolean; created_at?: string };
        Update: { name?: string; is_active?: boolean };
        Relationships: [];
      };
      horses: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          photo_path: string | null;
          horse_type: string;
          birth_year: number | null;
          veterinarian_name: string;
          veterinarian_phone: string;
          farrier_name: string;
          farrier_phone: string;
          deworming_schedule: string;
          vaccine_schedule: string;
          field_id: string | null;
          herd_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          photo_path?: string | null;
          horse_type?: string;
          birth_year?: number | null;
          veterinarian_name?: string;
          veterinarian_phone?: string;
          farrier_name?: string;
          farrier_phone?: string;
          deworming_schedule?: string;
          vaccine_schedule?: string;
          field_id?: string | null;
          herd_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          photo_path?: string | null;
          horse_type?: string;
          birth_year?: number | null;
          veterinarian_name?: string;
          veterinarian_phone?: string;
          farrier_name?: string;
          farrier_phone?: string;
          deworming_schedule?: string;
          vaccine_schedule?: string;
          field_id?: string | null;
          herd_id?: string | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      horse_access: {
        Row: {
          horse_id: string;
          profile_id: string;
          relationship: Database["public"]["Enums"]["horse_relationship"];
          granted_by: string;
          created_at: string;
        };
        Insert: {
          horse_id: string;
          profile_id: string;
          relationship?: Database["public"]["Enums"]["horse_relationship"];
          granted_by: string;
          created_at?: string;
        };
        Update: { relationship?: Database["public"]["Enums"]["horse_relationship"] };
        Relationships: [];
      };
      care_profiles: {
        Row: {
          horse_id: string;
          am_feed: string;
          pm_feed: string;
          supplements_am: string;
          supplements_pm: string;
          special_requirements: string;
          updated_by: string;
          updated_at: string;
        };
        Insert: {
          horse_id: string;
          am_feed?: string;
          pm_feed?: string;
          supplements_am?: string;
          supplements_pm?: string;
          special_requirements?: string;
          updated_by: string;
          updated_at?: string;
        };
        Update: {
          am_feed?: string;
          pm_feed?: string;
          supplements_am?: string;
          supplements_pm?: string;
          special_requirements?: string;
          updated_by?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      horse_medications: {
        Row: {
          id: string;
          horse_id: string;
          name: string;
          dosage: string;
          instructions: string;
          starts_on: string;
          ends_on: string | null;
          status: Database["public"]["Enums"]["medication_status"];
          created_by: string;
          created_at: string;
          updated_by: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          horse_id: string;
          name: string;
          dosage: string;
          instructions: string;
          starts_on: string;
          ends_on?: string | null;
          status?: Database["public"]["Enums"]["medication_status"];
          created_by: string;
          created_at?: string;
          updated_by: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          dosage?: string;
          instructions?: string;
          starts_on?: string;
          ends_on?: string | null;
          status?: Database["public"]["Enums"]["medication_status"];
          updated_by?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      horse_conversations: {
        Row: {
          id: string;
          organization_id: string;
          horse_id: string;
          last_message_at: string | null;
          last_staff_communication_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          horse_id: string;
          last_message_at?: string | null;
          last_staff_communication_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          last_message_at?: string | null;
          last_staff_communication_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      conversation_messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          kind: Database["public"]["Enums"]["conversation_message_kind"];
          body: string;
          hidden_at: string | null;
          hidden_by: string | null;
          created_at: string;
          edited_at: string | null;
          legacy_update_id: string | null;
          legacy_message_id: string | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          kind?: Database["public"]["Enums"]["conversation_message_kind"];
          body?: string;
          hidden_at?: string | null;
          hidden_by?: string | null;
          created_at?: string;
          edited_at?: string | null;
          legacy_update_id?: string | null;
          legacy_message_id?: string | null;
        };
        Update: {
          body?: string;
          hidden_at?: string | null;
          hidden_by?: string | null;
          edited_at?: string | null;
        };
        Relationships: [];
      };
      conversation_media: {
        Row: {
          id: string;
          message_id: string;
          uploaded_by: string;
          storage_bucket: string;
          storage_path: string;
          media_type: Database["public"]["Enums"]["media_type"];
          mime_type: string;
          original_filename: string;
          byte_size: number;
          duration_seconds: number | null;
          sort_order: number;
          created_at: string;
          legacy_update_media_id: string | null;
          legacy_message_media_id: string | null;
        };
        Insert: {
          id?: string;
          message_id: string;
          uploaded_by: string;
          storage_bucket: string;
          storage_path: string;
          media_type: Database["public"]["Enums"]["media_type"];
          mime_type: string;
          original_filename: string;
          byte_size: number;
          duration_seconds?: number | null;
          sort_order?: number;
          created_at?: string;
          legacy_update_media_id?: string | null;
          legacy_message_media_id?: string | null;
        };
        Update: { sort_order?: number };
        Relationships: [];
      };
      conversation_message_reads: {
        Row: { message_id: string; profile_id: string; read_at: string };
        Insert: { message_id: string; profile_id: string; read_at?: string };
        Update: { read_at?: string };
        Relationships: [];
      };
      weekly_updates: {
        Row: {
          id: string;
          organization_id: string;
          horse_id: string;
          author_id: string;
          week_start: string;
          body: string;
          published_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          horse_id: string;
          author_id: string;
          week_start: string;
          body: string;
          published_at?: string | null;
          updated_at?: string;
        };
        Update: { body?: string; published_at?: string | null; updated_at?: string };
        Relationships: [];
      };
      update_media: {
        Row: {
          id: string;
          update_id: string;
          uploaded_by: string;
          storage_path: string;
          media_type: Database["public"]["Enums"]["media_type"];
          mime_type: string;
          original_filename: string;
          byte_size: number;
          duration_seconds: number | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          update_id: string;
          uploaded_by: string;
          storage_path: string;
          media_type: Database["public"]["Enums"]["media_type"];
          mime_type: string;
          original_filename: string;
          byte_size: number;
          duration_seconds?: number | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: { sort_order?: number };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          update_id: string;
          sender_id: string;
          body: string;
          hidden_at: string | null;
          hidden_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          update_id: string;
          sender_id: string;
          body: string;
          hidden_at?: string | null;
          hidden_by?: string | null;
          created_at?: string;
        };
        Update: { hidden_at?: string | null; hidden_by?: string | null };
        Relationships: [];
      };
      message_media: {
        Row: {
          id: string;
          message_id: string;
          uploaded_by: string;
          storage_path: string;
          mime_type: string;
          original_filename: string;
          byte_size: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          message_id: string;
          uploaded_by: string;
          storage_path: string;
          mime_type: string;
          original_filename: string;
          byte_size: number;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      message_reads: {
        Row: { message_id: string; profile_id: string; read_at: string };
        Insert: { message_id: string; profile_id: string; read_at?: string };
        Update: { read_at?: string };
        Relationships: [];
      };
      care_change_log: {
        Row: {
          id: string;
          horse_id: string;
          changed_by: string;
          change_type: string;
          previous_values: Json;
          new_values: Json;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          horse_id: string | null;
          update_id: string | null;
          message_id: string | null;
          conversation_message_id: string | null;
          kind: Database["public"]["Enums"]["notification_kind"];
          title: string;
          body: string;
          read_at: string | null;
          push_sent_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: { read_at?: string | null };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh_key: string;
          auth_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh_key: string;
          auth_key: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: { p256dh_key?: string; auth_key?: string; updated_at?: string };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      can_access_horse: { Args: { target_horse_id: string }; Returns: boolean };
      can_access_conversation: { Args: { target_conversation_id: string }; Returns: boolean };
      can_access_conversation_message: { Args: { target_message_id: string }; Returns: boolean };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_staff: { Args: Record<PropertyKey, never>; Returns: boolean };
      renotify_weekly_update: { Args: { target_update_id: string }; Returns: undefined };
    };
    Enums: {
      app_role: "admin" | "stable_hand" | "owner";
      conversation_message_kind: "message" | "historical_update";
      horse_relationship: "primary_owner" | "family";
      media_type: "photo" | "video";
      medication_status: "active" | "completed" | "discontinued";
      notification_kind: "weekly_update" | "reply" | "care_change" | "medication_change";
    };
    CompositeTypes: Record<never, never>;
  };
};

type PublicSchema = Database["public"];

export type Tables<TableName extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][TableName]["Row"];

export type TablesInsert<TableName extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][TableName]["Insert"];

export type TablesUpdate<TableName extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][TableName]["Update"];
