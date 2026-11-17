/** Account selection and transport are host effects; document rules stay shared. */
function createViewPreferenceHandlers({ getClient, createClient }) {
  return {
    getViewPreferences: async () => createClient(getClient()).read(),
    saveViewPreferences: async input => createClient(getClient()).save(input),
  }
}

module.exports = { createViewPreferenceHandlers }
