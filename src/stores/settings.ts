import { create } from 'zustand'

interface SettingsState {
  aiApiKey: string
  telemetryEnabled: boolean
  loaded: boolean
  load: () => Promise<void>
  setAiApiKey: (key: string) => Promise<void>
  setTelemetryEnabled: (enabled: boolean) => Promise<void>
}

export const useSettings = create<SettingsState>((set) => ({
  aiApiKey: '',
  telemetryEnabled: false,
  loaded: false,

  load: async () => {
    const all = (await window.purroxy.settings.getAll()) as Record<string, unknown>
    set({
      aiApiKey: (all.aiApiKey as string) || '',
      telemetryEnabled: (all.telemetryEnabled as boolean) || false,
      loaded: true
    })
  },

  setAiApiKey: async (key: string) => {
    await window.purroxy.settings.set('aiApiKey', key)
    set({ aiApiKey: key })
  },

  setTelemetryEnabled: async (enabled: boolean) => {
    await window.purroxy.settings.set('telemetryEnabled', enabled)
    set({ telemetryEnabled: enabled })
  }
}))
