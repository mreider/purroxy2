import Store from 'electron-store'

export interface AppSettings {
  aiApiKey: string
  telemetryEnabled: boolean
}

const defaults: AppSettings = {
  aiApiKey: '',
  telemetryEnabled: false
}

export const store = new Store<AppSettings>({ defaults })
