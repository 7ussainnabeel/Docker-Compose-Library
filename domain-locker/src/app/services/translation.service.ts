import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { isPlatformBrowser } from '@angular/common';
import { REQUEST } from '@analogjs/router/tokens';

@Injectable({
  providedIn: 'root'
})
export class TranslationService {
  private platformId = inject(PLATFORM_ID);
  private defaultLang = 'en';

  // Define available languages with hard-coded metadata
  availableLanguages = [
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' }
  ];

  constructor(public translateService: TranslateService) {
    this.setInitialLanguage();
  }

  // Initialize the language based on URL param, stored preference, or default
  private setInitialLanguage() {
    const languageToUse = this.getLanguageToUse();
    this.translateService.setDefaultLang(this.defaultLang);
    this.translateService.use(languageToUse);
  }

  // Determine the language to use based on URL, localStorage, or default
  public getLanguageToUse(): string {
    let langFromUrl = null;
    let langFromStorage = null;
    if (isPlatformBrowser(this.platformId)) {
      const urlParams = new URLSearchParams(window.location.search);
      langFromUrl = urlParams?.get('lang') || null;
    } else {
      const request = inject(REQUEST);
      const urlParams = new URLSearchParams(request?.url?.split('?')[1]);
      langFromUrl = urlParams?.get('lang') || null;
    }
    if (isPlatformBrowser(this.platformId)) {
      langFromStorage = localStorage.getItem('language') || langFromUrl || this.defaultLang;
    }
    return langFromStorage || langFromUrl || this.defaultLang;
  }

  // Validate if the given language code is supported
  private isLanguageAvailable(langCode: string): boolean {
    return this.availableLanguages.some(lang => lang.code === langCode);
  }

  // Switch the language and store the preference
  switchLanguage(langCode: string) {
    if (!langCode || !this.isLanguageAvailable(langCode)) return;
    this.translateService.use(langCode);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('language', langCode);
    }
  }
}
