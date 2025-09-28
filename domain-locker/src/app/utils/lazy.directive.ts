import { Directive, ElementRef, EventEmitter, Output } from '@angular/core';

@Directive({
  selector: '[appLazyLoad]',
  standalone: true, 
})
export class LazyLoadDirective {
  @Output() visible = new EventEmitter<void>();

  private observer: IntersectionObserver;

  constructor(private el: ElementRef) {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.visible.emit();
            this.observer.disconnect(); // Stop observing once it's visible
          }
        });
      },
      { threshold: 0.1 } // Trigger when 10% of the element is visible
    );
  }

  ngAfterViewInit(): void {
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer.disconnect();
  }
}
