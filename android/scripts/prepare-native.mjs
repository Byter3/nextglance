import {mkdir} from 'node:fs/promises'

// Capacitor 8 update copies web assets when this native directory is absent.
// Creating the ignored directory allows source-only native checks on a fresh
// checkout without dist, a UI build, or placeholder application content.
await mkdir(new URL('../android/app/src/main/assets/public/', import.meta.url), {recursive: true})
