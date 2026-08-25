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
      character_assets: {
        Row: {
          character_id: string
          created_at: string
          height_px: number
          id: string
          is_primary: boolean
          kind: Database["public"]["Enums"]["character_asset_kind"]
          model_id: string | null
          prompt_hash: string | null
          storage_key: string
          version: number
          width_px: number
        }
        Insert: {
          character_id: string
          created_at?: string
          height_px: number
          id?: string
          is_primary?: boolean
          kind: Database["public"]["Enums"]["character_asset_kind"]
          model_id?: string | null
          prompt_hash?: string | null
          storage_key: string
          version?: number
          width_px: number
        }
        Update: {
          character_id?: string
          created_at?: string
          height_px?: number
          id?: string
          is_primary?: boolean
          kind?: Database["public"]["Enums"]["character_asset_kind"]
          model_id?: string | null
          prompt_hash?: string | null
          storage_key?: string
          version?: number
          width_px?: number
        }
        Relationships: [
          {
            foreignKeyName: "character_assets_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      characters: {
        Row: {
          archived_at: string | null
          character_type: string | null
          child_id: string
          created_at: string
          drawing_id: string
          feature_anchor: string | null
          id: string
          name: string
          palette: string[]
          personality_traits: string[]
          status: Database["public"]["Enums"]["character_status"]
        }
        Insert: {
          archived_at?: string | null
          character_type?: string | null
          child_id: string
          created_at?: string
          drawing_id: string
          feature_anchor?: string | null
          id?: string
          name: string
          palette?: string[]
          personality_traits?: string[]
          status?: Database["public"]["Enums"]["character_status"]
        }
        Update: {
          archived_at?: string | null
          character_type?: string | null
          child_id?: string
          created_at?: string
          drawing_id?: string
          feature_anchor?: string | null
          id?: string
          name?: string
          palette?: string[]
          personality_traits?: string[]
          status?: Database["public"]["Enums"]["character_status"]
        }
        Relationships: [
          {
            foreignKeyName: "characters_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "child_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_drawing_id_fkey"
            columns: ["drawing_id"]
            isOneToOne: false
            referencedRelation: "original_drawings"
            referencedColumns: ["id"]
          },
        ]
      }
      child_profiles: {
        Row: {
          age_band: Database["public"]["Enums"]["age_band"]
          avatar_character_id: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          id: string
          parent_id: string
        }
        Insert: {
          age_band: Database["public"]["Enums"]["age_band"]
          avatar_character_id?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          parent_id: string
        }
        Update: {
          age_band?: Database["public"]["Enums"]["age_band"]
          avatar_character_id?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          parent_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "child_profiles_avatar_character_id_fkey"
            columns: ["avatar_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_profiles_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parent_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_jobs: {
        Row: {
          attempts: number
          character_id: string | null
          cost_cents: number
          cost_reserved: boolean
          created_at: string
          error_code: Database["public"]["Enums"]["job_error_code"] | null
          estimated_cost_cents: number
          finished_at: string | null
          id: string
          idempotency_key: string
          latency_ms: number | null
          pages_completed: number
          pages_total: number
          parent_id: string
          quota_refunded: boolean
          stage: Database["public"]["Enums"]["generation_stage"]
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          story_id: string | null
          type: Database["public"]["Enums"]["job_type"]
        }
        Insert: {
          attempts?: number
          character_id?: string | null
          cost_cents?: number
          cost_reserved?: boolean
          created_at?: string
          error_code?: Database["public"]["Enums"]["job_error_code"] | null
          estimated_cost_cents?: number
          finished_at?: string | null
          id?: string
          idempotency_key: string
          latency_ms?: number | null
          pages_completed?: number
          pages_total?: number
          parent_id: string
          quota_refunded?: boolean
          stage?: Database["public"]["Enums"]["generation_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          story_id?: string | null
          type: Database["public"]["Enums"]["job_type"]
        }
        Update: {
          attempts?: number
          character_id?: string | null
          cost_cents?: number
          cost_reserved?: boolean
          created_at?: string
          error_code?: Database["public"]["Enums"]["job_error_code"] | null
          estimated_cost_cents?: number
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          latency_ms?: number | null
          pages_completed?: number
          pages_total?: number
          parent_id?: string
          quota_refunded?: boolean
          stage?: Database["public"]["Enums"]["generation_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          story_id?: string | null
          type?: Database["public"]["Enums"]["job_type"]
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parent_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_events: {
        Row: {
          action_taken: Database["public"]["Enums"]["moderation_action"]
          categories: string[]
          created_at: string
          id: string
          parent_id: string
          provider: string
          raw_score: number | null
          stage: Database["public"]["Enums"]["moderation_stage"]
          subject_id: string
          subject_type: Database["public"]["Enums"]["moderation_subject_type"]
          verdict: Database["public"]["Enums"]["moderation_verdict"]
        }
        Insert: {
          action_taken: Database["public"]["Enums"]["moderation_action"]
          categories?: string[]
          created_at?: string
          id?: string
          parent_id: string
          provider: string
          raw_score?: number | null
          stage: Database["public"]["Enums"]["moderation_stage"]
          subject_id: string
          subject_type: Database["public"]["Enums"]["moderation_subject_type"]
          verdict: Database["public"]["Enums"]["moderation_verdict"]
        }
        Update: {
          action_taken?: Database["public"]["Enums"]["moderation_action"]
          categories?: string[]
          created_at?: string
          id?: string
          parent_id?: string
          provider?: string
          raw_score?: number | null
          stage?: Database["public"]["Enums"]["moderation_stage"]
          subject_id?: string
          subject_type?: Database["public"]["Enums"]["moderation_subject_type"]
          verdict?: Database["public"]["Enums"]["moderation_verdict"]
        }
        Relationships: [
          {
            foreignKeyName: "moderation_events_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parent_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      narrations: {
        Row: {
          created_at: string
          duration_ms: number
          id: string
          language: string
          provider: string
          sentence_level_only: boolean
          storage_key: string
          story_id: string
          voice_id: string
          word_timings_key: string | null
        }
        Insert: {
          created_at?: string
          duration_ms: number
          id?: string
          language: string
          provider: string
          sentence_level_only?: boolean
          storage_key: string
          story_id: string
          voice_id: string
          word_timings_key?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number
          id?: string
          language?: string
          provider?: string
          sentence_level_only?: boolean
          storage_key?: string
          story_id?: string
          voice_id?: string
          word_timings_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "narrations_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      original_drawings: {
        Row: {
          captured_at: string
          child_id: string
          created_at: string
          cutout_storage_key: string
          deleted_at: string | null
          exif_stripped: boolean
          face_detected: boolean
          height_px: number
          id: string
          isolation_confidence: number
          isolation_method: Database["public"]["Enums"]["isolation_method"]
          retention_policy: Database["public"]["Enums"]["retention_policy"]
          source: Database["public"]["Enums"]["drawing_source"]
          storage_key: string | null
          text_detected: boolean
          width_px: number
        }
        Insert: {
          captured_at: string
          child_id: string
          created_at?: string
          cutout_storage_key: string
          deleted_at?: string | null
          exif_stripped?: boolean
          face_detected?: boolean
          height_px: number
          id?: string
          isolation_confidence: number
          isolation_method: Database["public"]["Enums"]["isolation_method"]
          retention_policy: Database["public"]["Enums"]["retention_policy"]
          source: Database["public"]["Enums"]["drawing_source"]
          storage_key?: string | null
          text_detected?: boolean
          width_px: number
        }
        Update: {
          captured_at?: string
          child_id?: string
          created_at?: string
          cutout_storage_key?: string
          deleted_at?: string | null
          exif_stripped?: boolean
          face_detected?: boolean
          height_px?: number
          id?: string
          isolation_confidence?: number
          isolation_method?: Database["public"]["Enums"]["isolation_method"]
          retention_policy?: Database["public"]["Enums"]["retention_policy"]
          source?: Database["public"]["Enums"]["drawing_source"]
          storage_key?: string | null
          text_detected?: boolean
          width_px?: number
        }
        Relationships: [
          {
            foreignKeyName: "original_drawings_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "child_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_illustrations: {
        Row: {
          cost_cents: number
          created_at: string
          height: number
          id: string
          model_id: string
          moderation_verdict: Database["public"]["Enums"]["moderation_verdict"]
          page_index: number
          parent_id: string
          reference_asset_ids: string[]
          seed: number | null
          storage_key: string
          story_id: string
          width: number
        }
        Insert: {
          cost_cents?: number
          created_at?: string
          height: number
          id?: string
          model_id: string
          moderation_verdict?: Database["public"]["Enums"]["moderation_verdict"]
          page_index: number
          parent_id: string
          reference_asset_ids?: string[]
          seed?: number | null
          storage_key: string
          story_id: string
          width: number
        }
        Update: {
          cost_cents?: number
          created_at?: string
          height?: number
          id?: string
          model_id?: string
          moderation_verdict?: Database["public"]["Enums"]["moderation_verdict"]
          page_index?: number
          parent_id?: string
          reference_asset_ids?: string[]
          seed?: number | null
          storage_key?: string
          story_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "page_illustrations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parent_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_illustrations_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_accounts: {
        Row: {
          created_at: string
          deleted_at: string | null
          email_hash: string | null
          id: string
          is_anonymous: boolean
          linked_providers: Database["public"]["Enums"]["auth_provider"][]
          locale: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          email_hash?: string | null
          id: string
          is_anonymous?: boolean
          linked_providers?: Database["public"]["Enums"]["auth_provider"][]
          locale?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          email_hash?: string | null
          id?: string
          is_anonymous?: boolean
          linked_providers?: Database["public"]["Enums"]["auth_provider"][]
          locale?: string
        }
        Relationships: []
      }
      places: {
        Row: {
          created_at: string
          description: string
          first_story_id: string | null
          id: string
          name: string
          style_ref_asset_id: string | null
          world_id: string
        }
        Insert: {
          created_at?: string
          description: string
          first_story_id?: string | null
          id?: string
          name: string
          style_ref_asset_id?: string | null
          world_id: string
        }
        Update: {
          created_at?: string
          description?: string
          first_story_id?: string | null
          id?: string
          name?: string
          style_ref_asset_id?: string | null
          world_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "places_first_story_id_fkey"
            columns: ["first_story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "places_style_ref_asset_id_fkey"
            columns: ["style_ref_asset_id"]
            isOneToOne: false
            referencedRelation: "character_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "places_world_id_fkey"
            columns: ["world_id"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["id"]
          },
        ]
      }
      revenuecat_event_inbox: {
        Row: {
          app_user_id: string
          attempts: number
          environment: string
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          received_at: string
        }
        Insert: {
          app_user_id: string
          attempts?: number
          environment: string
          event_id: string
          event_type: string
          id?: string
          last_error?: string | null
          payload: Json
          processed_at?: string | null
          received_at?: string
        }
        Update: {
          app_user_id?: string
          attempts?: number
          environment?: string
          event_id?: string
          event_type?: string
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          received_at?: string
        }
        Relationships: []
      }
      stories: {
        Row: {
          character_tombstone: boolean
          child_id: string
          completed_at: string | null
          cover_asset_id: string | null
          created_at: string
          deleted_at: string | null
          favourited_at: string | null
          id: string
          length: Database["public"]["Enums"]["story_length"]
          model_bundle_version: string
          mood: Database["public"]["Enums"]["story_mood"]
          render_technique: Database["public"]["Enums"]["render_technique"]
          status: Database["public"]["Enums"]["story_status"]
          theme: Database["public"]["Enums"]["story_theme"]
          title: string | null
        }
        Insert: {
          character_tombstone?: boolean
          child_id: string
          completed_at?: string | null
          cover_asset_id?: string | null
          created_at?: string
          deleted_at?: string | null
          favourited_at?: string | null
          id?: string
          length: Database["public"]["Enums"]["story_length"]
          model_bundle_version: string
          mood: Database["public"]["Enums"]["story_mood"]
          render_technique?: Database["public"]["Enums"]["render_technique"]
          status?: Database["public"]["Enums"]["story_status"]
          theme: Database["public"]["Enums"]["story_theme"]
          title?: string | null
        }
        Update: {
          character_tombstone?: boolean
          child_id?: string
          completed_at?: string | null
          cover_asset_id?: string | null
          created_at?: string
          deleted_at?: string | null
          favourited_at?: string | null
          id?: string
          length?: Database["public"]["Enums"]["story_length"]
          model_bundle_version?: string
          mood?: Database["public"]["Enums"]["story_mood"]
          render_technique?: Database["public"]["Enums"]["render_technique"]
          status?: Database["public"]["Enums"]["story_status"]
          theme?: Database["public"]["Enums"]["story_theme"]
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stories_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "child_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stories_cover_asset_id_fkey"
            columns: ["cover_asset_id"]
            isOneToOne: false
            referencedRelation: "page_illustrations"
            referencedColumns: ["id"]
          },
        ]
      }
      story_characters: {
        Row: {
          character_id: string
          order_index: number
          role: Database["public"]["Enums"]["story_character_role"]
          story_id: string
        }
        Insert: {
          character_id: string
          order_index?: number
          role?: Database["public"]["Enums"]["story_character_role"]
          story_id: string
        }
        Update: {
          character_id?: string
          order_index?: number
          role?: Database["public"]["Enums"]["story_character_role"]
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_characters_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_characters_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      story_pages: {
        Row: {
          created_at: string
          id: string
          illustration_asset_id: string | null
          index: number
          parent_id: string
          regen_count: number
          scene_description: string
          status: Database["public"]["Enums"]["story_page_status"]
          story_id: string
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          illustration_asset_id?: string | null
          index: number
          parent_id: string
          regen_count?: number
          scene_description: string
          status?: Database["public"]["Enums"]["story_page_status"]
          story_id: string
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          illustration_asset_id?: string | null
          index?: number
          parent_id?: string
          regen_count?: number
          scene_description?: string
          status?: Database["public"]["Enums"]["story_page_status"]
          story_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_pages_illustration_asset_id_fkey"
            columns: ["illustration_asset_id"]
            isOneToOne: false
            referencedRelation: "page_illustrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_pages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parent_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_pages_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          environment: Database["public"]["Enums"]["store_environment"]
          expires_at: string | null
          id: string
          original_transaction_id: string | null
          parent_id: string
          product_id: Database["public"]["Enums"]["product_id"] | null
          renews_at: string | null
          revenuecat_app_user_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          tier: Database["public"]["Enums"]["entitlement_tier"]
          topup_stories_remaining: number
          updated_at: string
        }
        Insert: {
          environment?: Database["public"]["Enums"]["store_environment"]
          expires_at?: string | null
          id?: string
          original_transaction_id?: string | null
          parent_id: string
          product_id?: Database["public"]["Enums"]["product_id"] | null
          renews_at?: string | null
          revenuecat_app_user_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          tier?: Database["public"]["Enums"]["entitlement_tier"]
          topup_stories_remaining?: number
          updated_at?: string
        }
        Update: {
          environment?: Database["public"]["Enums"]["store_environment"]
          expires_at?: string | null
          id?: string
          original_transaction_id?: string | null
          parent_id?: string
          product_id?: Database["public"]["Enums"]["product_id"] | null
          renews_at?: string | null
          revenuecat_app_user_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          tier?: Database["public"]["Enums"]["entitlement_tier"]
          topup_stories_remaining?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parent_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_records: {
        Row: {
          characters_used: number
          cost_cents_accrued: number
          cost_cents_reserved: number
          id: string
          parent_id: string
          period_end: string | null
          period_start: string
          regens_used: number
          stories_used: number
          updated_at: string
        }
        Insert: {
          characters_used?: number
          cost_cents_accrued?: number
          cost_cents_reserved?: number
          id?: string
          parent_id: string
          period_end?: string | null
          period_start: string
          regens_used?: number
          stories_used?: number
          updated_at?: string
        }
        Update: {
          characters_used?: number
          cost_cents_accrued?: number
          cost_cents_reserved?: number
          id?: string
          parent_id?: string
          period_end?: string | null
          period_start?: string
          regens_used?: number
          stories_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_records_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parent_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      world_facts: {
        Row: {
          confidence: number
          created_at: string
          fact_text: string
          id: string
          source_story_id: string | null
          subject_id: string
          subject_type: string
          superseded_by: string | null
          world_id: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          fact_text: string
          id?: string
          source_story_id?: string | null
          subject_id: string
          subject_type: string
          superseded_by?: string | null
          world_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          fact_text?: string
          id?: string
          source_story_id?: string | null
          subject_id?: string
          subject_type?: string
          superseded_by?: string | null
          world_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_facts_source_story_id_fkey"
            columns: ["source_story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "world_facts_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "world_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "world_facts_world_id_fkey"
            columns: ["world_id"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["id"]
          },
        ]
      }
      worlds: {
        Row: {
          child_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          child_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          child_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "worlds_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "child_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_revenuecat_event: {
        Args: {
          p_environment: Database["public"]["Enums"]["store_environment"]
          p_expires_at: string
          p_is_topup?: boolean
          p_original_transaction_id: string
          p_parent_id: string
          p_product_id: Database["public"]["Enums"]["product_id"]
          p_renews_at: string
          p_revenuecat_app_user_id: string
          p_status: Database["public"]["Enums"]["subscription_status"]
          p_tier: Database["public"]["Enums"]["entitlement_tier"]
        }
        Returns: undefined
      }
      claim_story_quota: {
        Args: {
          p_character_ids: string[]
          p_child_id: string
          p_idempotency_key: string
          p_length: Database["public"]["Enums"]["story_length"]
          p_model_bundle_version: string
          p_mood: Database["public"]["Enums"]["story_mood"]
          p_render_technique: Database["public"]["Enums"]["render_technique"]
          p_theme: Database["public"]["Enums"]["story_theme"]
        }
        Returns: Json
      }
      enqueue_revenuecat_event: {
        Args: {
          p_app_user_id: string
          p_environment: string
          p_event_id: string
          p_event_type: string
          p_payload: Json
        }
        Returns: undefined
      }
      merge_accounts: {
        Args: {
          p_source_parent_id: string
          p_strategy: Database["public"]["Enums"]["merge_strategy"]
          p_target_parent_id: string
        }
        Returns: undefined
      }
      purge_expired_soft_deletes: { Args: never; Returns: undefined }
      record_cost: {
        Args: { p_cost_cents: number; p_final?: boolean; p_job_id: string }
        Returns: undefined
      }
      refund_story_quota: { Args: { p_job_id: string }; Returns: Json }
    }
    Enums: {
      age_band: "4_5" | "6_7" | "8_plus"
      auth_provider: "anonymous" | "apple" | "google"
      character_asset_kind: "cutout" | "reference_sheet" | "pose" | "style_ref"
      character_status: "draft" | "building" | "ready" | "failed" | "archived"
      drawing_source: "camera" | "photos"
      entitlement_tier: "free" | "family"
      generation_stage:
        | "queued"
        | "moderating_input"
        | "analysing_drawing"
        | "building_character_refs"
        | "validating_request"
        | "writing_story"
        | "moderating_text"
        | "illustrating_cover"
        | "illustrating_pages"
        | "moderating_images"
        | "narrating"
        | "assembling"
        | "done"
      isolation_method:
        | "vision_subject_lift"
        | "ink_extraction"
        | "manual_repair"
      job_error_code:
        | "moderation_blocked_input_image"
        | "moderation_blocked_input_text"
        | "moderation_blocked_output_text"
        | "moderation_blocked_output_image"
        | "reading_level_failed"
        | "invalid_structured_output"
        | "provider_timeout"
        | "provider_error"
        | "provider_rate_limited"
        | "provider_safety_refusal"
        | "regen_budget_exhausted"
        | "cost_ceiling_exceeded"
        | "storage_error"
        | "cancelled"
        | "internal"
      job_status:
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "dead_letter"
      job_type:
        | "character_build"
        | "story_generate"
        | "page_regenerate"
        | "narration_generate"
      merge_strategy: "merge" | "keep_account_only"
      moderation_action:
        | "none"
        | "soft_retry"
        | "blocked_and_refunded"
        | "blocked_story_failed"
        | "name_rejected"
        | "trait_dropped"
      moderation_stage:
        | "input_image"
        | "input_text"
        | "output_text"
        | "output_image"
      moderation_subject_type:
        | "original_drawing"
        | "character_cutout"
        | "character_name"
        | "character_traits"
        | "story_request"
        | "story_page_text"
        | "page_illustration"
        | "narration"
      moderation_verdict: "pass" | "flag" | "block"
      product_id:
        | "papercub_family_monthly"
        | "papercub_family_annual"
        | "papercub_topup_3"
      quota_block_reason:
        | "story_quota_exhausted"
        | "character_quota_exhausted"
        | "cost_ceiling_reached"
        | "global_spend_halt"
        | "rate_limited"
        | "free_tier_consumed"
      render_technique:
        | "paper_cutout_composite"
        | "cutout_rerender"
        | "multi_reference"
      retention_policy: "delete_after_cutout" | "keep_original"
      store_environment: "sandbox" | "production"
      story_character_role: "lead" | "companion"
      story_length: "short" | "normal" | "bedtime"
      story_mood: "funny" | "adventurous" | "calm"
      story_page_status:
        | "pending"
        | "text_ready"
        | "illustrating"
        | "ready"
        | "failed"
      story_status:
        | "draft"
        | "queued"
        | "generating"
        | "partial"
        | "ready"
        | "failed"
        | "deleted"
      story_theme:
        | "space"
        | "dinosaurs"
        | "underwater"
        | "magic"
        | "pirates"
        | "jungle"
      subscription_status:
        | "none"
        | "active"
        | "in_grace_period"
        | "in_billing_retry"
        | "expired"
        | "revoked"
        | "paused"
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
    Enums: {
      age_band: ["4_5", "6_7", "8_plus"],
      auth_provider: ["anonymous", "apple", "google"],
      character_asset_kind: ["cutout", "reference_sheet", "pose", "style_ref"],
      character_status: ["draft", "building", "ready", "failed", "archived"],
      drawing_source: ["camera", "photos"],
      entitlement_tier: ["free", "family"],
      generation_stage: [
        "queued",
        "moderating_input",
        "analysing_drawing",
        "building_character_refs",
        "validating_request",
        "writing_story",
        "moderating_text",
        "illustrating_cover",
        "illustrating_pages",
        "moderating_images",
        "narrating",
        "assembling",
        "done",
      ],
      isolation_method: [
        "vision_subject_lift",
        "ink_extraction",
        "manual_repair",
      ],
      job_error_code: [
        "moderation_blocked_input_image",
        "moderation_blocked_input_text",
        "moderation_blocked_output_text",
        "moderation_blocked_output_image",
        "reading_level_failed",
        "invalid_structured_output",
        "provider_timeout",
        "provider_error",
        "provider_rate_limited",
        "provider_safety_refusal",
        "regen_budget_exhausted",
        "cost_ceiling_exceeded",
        "storage_error",
        "cancelled",
        "internal",
      ],
      job_status: [
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
        "dead_letter",
      ],
      job_type: [
        "character_build",
        "story_generate",
        "page_regenerate",
        "narration_generate",
      ],
      merge_strategy: ["merge", "keep_account_only"],
      moderation_action: [
        "none",
        "soft_retry",
        "blocked_and_refunded",
        "blocked_story_failed",
        "name_rejected",
        "trait_dropped",
      ],
      moderation_stage: [
        "input_image",
        "input_text",
        "output_text",
        "output_image",
      ],
      moderation_subject_type: [
        "original_drawing",
        "character_cutout",
        "character_name",
        "character_traits",
        "story_request",
        "story_page_text",
        "page_illustration",
        "narration",
      ],
      moderation_verdict: ["pass", "flag", "block"],
      product_id: [
        "papercub_family_monthly",
        "papercub_family_annual",
        "papercub_topup_3",
      ],
      quota_block_reason: [
        "story_quota_exhausted",
        "character_quota_exhausted",
        "cost_ceiling_reached",
        "global_spend_halt",
        "rate_limited",
        "free_tier_consumed",
      ],
      render_technique: [
        "paper_cutout_composite",
        "cutout_rerender",
        "multi_reference",
      ],
      retention_policy: ["delete_after_cutout", "keep_original"],
      store_environment: ["sandbox", "production"],
      story_character_role: ["lead", "companion"],
      story_length: ["short", "normal", "bedtime"],
      story_mood: ["funny", "adventurous", "calm"],
      story_page_status: [
        "pending",
        "text_ready",
        "illustrating",
        "ready",
        "failed",
      ],
      story_status: [
        "draft",
        "queued",
        "generating",
        "partial",
        "ready",
        "failed",
        "deleted",
      ],
      story_theme: [
        "space",
        "dinosaurs",
        "underwater",
        "magic",
        "pirates",
        "jungle",
      ],
      subscription_status: [
        "none",
        "active",
        "in_grace_period",
        "in_billing_retry",
        "expired",
        "revoked",
        "paused",
      ],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

