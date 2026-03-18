import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

interface Message {
  id?: number;
  role: 'user' | 'assistant' | 'system' | 'function';
  content: string;
  name?: string;
  timestamp?: string;
}

export class MemoryService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
  }

  // Chat History
  async addMessage(role: string, content: string, name?: string) {
    const { error } = await this.supabase
      .from('ammarclaw_messages')
      .insert([{ role, content, name }]);
    if (error) console.error("[Memory] Error adding message:", error);
  }

  async getHistory(limit: number = 50): Promise<Message[]> {
    const { data, error } = await this.supabase
      .from('ammarclaw_messages')
      .select('*')
      .order('id', { ascending: false })
      .limit(limit);
    
    if (error) {
        console.error("[Memory] Error getting history:", error);
        return [];
    }
    return (data as Message[]).reverse();
  }

  async clearHistory() {
    const { error } = await this.supabase
      .from('ammarclaw_messages')
      .delete()
      .neq('id', 0); // Delete all
    if (error) console.error("[Memory] Error clearing history:", error);
  }

  // Persistent Facts
  async setFact(key: string, value: string) {
    const { error } = await this.supabase
      .from('ammarclaw_kv_store')
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) console.error("[Memory] Error setting fact:", error);
  }

  async getFact(key: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('ammarclaw_kv_store')
      .select('value')
      .eq('key', key)
      .single();
    if (error) return null;
    return data?.value || null;
  }
  
  async getAllFacts(): Promise<Record<string, string>> {
      const { data, error } = await this.supabase
        .from('ammarclaw_kv_store')
        .select('key, value');
      if (error) return {};
      return (data || []).reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
  }

  // Tool Approvals
  async setPendingAction(name: string, args: any) {
    await this.clearPendingAction();
    const { error } = await this.supabase
      .from('ammarclaw_pending_actions')
      .insert([{ id: 1, tool_name: name, args: JSON.stringify(args) }]);
    if (error) console.error("[Memory] Error setting pending action:", error);
  }

  async getPendingAction(): Promise<{ name: string, args: any } | null> {
    const { data, error } = await this.supabase
      .from('ammarclaw_pending_actions')
      .select('tool_name, args')
      .eq('id', 1)
      .single();
    if (error || !data) return null;
    return { name: data.tool_name, args: JSON.parse(data.args) };
  }

  async clearPendingAction() {
    await this.supabase.from('ammarclaw_pending_actions').delete().eq('id', 1);
  }

  // Scheduling
  async addSchedule(userId: string, prompt: string, intervalType: string, intervalValue: number, nextRun: string) {
    const { error } = await this.supabase
      .from('ammarclaw_schedules')
      .insert([{ 
          user_id: userId, 
          prompt, 
          interval_type: intervalType, 
          interval_value: intervalValue, 
          next_run: nextRun 
      }]);
    if (error) console.error("[Memory] Error adding schedule:", error);
  }

  async getSchedules() {
    const { data, error } = await this.supabase.from('ammarclaw_schedules').select('*');
    if (error) return [];
    return data;
  }

  async getPendingSchedules() {
    const { data, error } = await this.supabase
      .from('ammarclaw_schedules')
      .select('*')
      .lte('next_run', new Date().toISOString());
    if (error) return [];
    return data;
  }

  async updateScheduleRun(id: number, nextRun: string) {
    const { error } = await this.supabase
      .from('ammarclaw_schedules')
      .update({ last_run: new Date().toISOString(), next_run: nextRun })
      .eq('id', id);
    if (error) console.error("[Memory] Error updating schedule:", error);
  }

  async removeSchedule(id: number) {
    const { error } = await this.supabase.from('ammarclaw_schedules').delete().eq('id', id);
    if (error) console.error("[Memory] Error removing schedule:", error);
  }

  async removeAllMemory() {
    await Promise.all([
      this.supabase.from('ammarclaw_messages').delete().neq('id', 0),
      this.supabase.from('ammarclaw_kv_store').delete().neq('key', ''),
      this.supabase.from('ammarclaw_pending_actions').delete().eq('id', 1),
      this.supabase.from('ammarclaw_schedules').delete().neq('id', 0)
    ]);
  }
}

export const memory = new MemoryService();
