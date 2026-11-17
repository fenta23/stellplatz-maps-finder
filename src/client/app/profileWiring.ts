import { ProfileDialog } from '@/features/profile/ProfileDialog.js'
import type { IProfileStore } from '@/features/profile/ProfileStore.js'
import {
  PROFILES, applyProfilePlan, isProfile, presetFor, profileOptions,
} from '@/features/profile/profileModel.js'
import type { IFilterStore } from '@/features/filters/FilterStore.js'
import type { HelpProfiles } from '@/features/help/HelpPanel.js'

export interface ProfileWiringDeps {
  readonly store: IProfileStore
  readonly filterStore: IFilterStore
  readonly dialogContainer: HTMLElement
  readonly flash: (msg: string) => void
}

export interface ProfileWiring {
  open(): void
  close(): void
  isOpen(): boolean
  /** Deps for the help wizard's profile step (ids are plain strings there). */
  readonly helpProfiles: HelpProfiles
}

export function createProfileWiring(deps: ProfileWiringDeps): ProfileWiring {
  const { store, filterStore, flash } = deps

  const dialog = new ProfileDialog(deps.dialogContainer, {
    getSelected: () => store.get(),
    getFilters: () => filterStore.list(),
    onApply: (profiles, plan) => {
      applyProfilePlan(filterStore, plan)
      store.set(profiles)
      const labels = PROFILES.filter(p => profiles.includes(p.id)).map(p => p.label)
      flash(labels.length > 0 ? `Profil übernommen: ${labels.join(', ')}` : 'Profil zurückgesetzt')
    },
  })

  const helpProfiles: HelpProfiles = {
    options: profileOptions(),
    getSelected: () => store.get(),
    presetFor: ids => presetFor(ids.filter(isProfile)),
    // The wizard applies the filters itself; this only remembers the choice.
    onChosen: ids => store.set(ids.filter(isProfile)),
  }

  return {
    open: () => dialog.open(),
    close: () => dialog.close(),
    isOpen: () => dialog.isOpen(),
    helpProfiles,
  }
}
