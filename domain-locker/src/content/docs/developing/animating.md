---
slug: animating
title: Animating In
description: Subtle on-scroll animations for cards and components
coverImage: 
---

To animate cards or components as they scroll into view, we just use PrimeNG's `pAnimateOnScroll` directive.
This makes it easy to add subtle animations with minimal configuration, which adds to the user experience.

### How to Use

1. Add the `pAnimateOnScroll` attribute to the component or card you want to animate.
2. Specify the animation classes for entering (`enterClass`) and leaving (`leaveClass`).

#### Example:

```html
<div class="card" 
     pAnimateOnScroll 
     enterClass="fadeIn" 
     leaveClass="fadeOut">
  <h3>Example Card</h3>
  <p>This card animates as you scroll!</p>
</div>
```

This uses our default fade animation, defined globally in `styles.css`.

### Creating Custom Animations

If the default animations don't meet your needs, you can define custom classes in the global CSS:

1. Create a custom animation keyframe.
2. Add the class with the desired animation properties.

#### Example:

```css
.slideIn {
  animation: slideInLeft 0.7s forwards;
}
@keyframes slideInLeft {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
```

Apply your custom class using the `pAnimateOnScroll` directive:

```html
<div class="custom-card" 
     pAnimateOnScroll 
     enterClass="slideIn" 
     leaveClass="fadeOut">
  <h3>Custom Animated Card</h3>
</div>
```

### Notes

- **Browser Support**: This works across all modern browsers and devices
- **Performance**: Having many many animations on a large page, can cause perf issues on low-end devices.
- **Accessibility**: In the accessibility settings, users have the option to disable animations
