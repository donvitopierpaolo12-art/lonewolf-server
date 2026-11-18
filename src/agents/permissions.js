const ROLES = {
  core: {
    name: 'LONEWOLF CORE',
    description: 'Monitoraggio dello stato operativo, metriche, salute API e coordinamento con GUARD',
    permissions: [
      'read_metrics',
      'read_security_snapshot',
      'request_containment',
      'query_guard_integrity',
      'log_activity'
    ]
  },
  guard: {
    name: 'LONEWOLF GUARD',
    description: 'Analisi degli eventi di sicurezza, rilevamento anomalie e tentativi ripetuti',
    permissions: [
      'read_security_events',
      'log_activity',
      'report_to_core'
    ]
  }
};

module.exports = { ROLES };
