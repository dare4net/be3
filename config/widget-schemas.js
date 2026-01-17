// Widget Schema System
// Defines configuration structure for all widgets to power the visual configuration editor

export const FIELD_TYPES = {
    TEXT: 'text',
    TEXTAREA: 'textarea',
    NUMBER: 'number',
    SELECT: 'select',
    MULTI_SELECT: 'multi_select',
    COLOR: 'color',
    GRADIENT: 'gradient',
    IMAGE: 'image',
    VIDEO: 'video',
    ICON: 'icon',
    FONT: 'font',
    SPACING: 'spacing',
    ANIMATION: 'animation',
    LAYOUT: 'layout',
    BORDER: 'border',
    SHADOW: 'shadow',
    ARRAY: 'array',
    OBJECT: 'object',
    BOOLEAN: 'boolean',
    LINK: 'link',
    RESPONSIVE: 'responsive'
};

export const WIDGET_CATEGORIES = {
    LAYOUT: 'Layout',
    CONTENT: 'Content',
    MARKETING: 'Marketing',
    ECOMMERCE: 'E-Commerce',
    INTERACTIVE: 'Interactive',
    PRIMITIVE: 'Primitive'
};

export const WIDGET_SCHEMAS = {
    hero: {
        label: 'Hero Section',
        icon: 'layout',
        category: WIDGET_CATEGORIES.LAYOUT,
        description: 'Large hero banner with image/video background, title, and CTA buttons',
        fields: [
            {
                key: 'layout',
                label: 'Layout Style',
                type: FIELD_TYPES.SELECT,
                options: [
                    { value: 'centered', label: 'Centered', preview: '📐 Centered' },
                    { value: 'left', label: 'Left Aligned', preview: '◀️ Left' },
                    { value: 'right', label: 'Right Aligned', preview: '▶️ Right' },
                    { value: 'split', label: 'Split Screen', preview: '⬌ Split' },
                    { value: 'fullscreen', label: 'Full Screen', preview: '⛶ Full' }
                ],
                default: 'centered'
            },
            {
                key: 'height',
                label: 'Section Height',
                type: FIELD_TYPES.RESPONSIVE,
                units: ['px', 'vh', '%'],
                default: { desktop: '600px', tablet: '500px', mobile: '400px' }
            },
            {
                key: 'backgroundType',
                label: 'Background Type',
                type: FIELD_TYPES.SELECT,
                options: [
                    { value: 'image', label: '🖼️ Image' },
                    { value: 'video', label: '🎥 Video' },
                    { value: 'gradient', label: '🌈 Gradient' },
                    { value: 'particles', label: '✨ Particles' },
                    { value: 'solid', label: '🎨 Solid Color' }
                ],
                default: 'image'
            },
            {
                key: 'backgroundImage',
                label: 'Background Image',
                type: FIELD_TYPES.IMAGE,
                showIf: { field: 'backgroundType', value: 'image' },
                default: ''
            },
            {
                key: 'backgroundVideo',
                label: 'Background Video URL',
                type: FIELD_TYPES.VIDEO,
                showIf: { field: 'backgroundType', value: 'video' },
                default: '',
                help: 'Supports YouTube, Vimeo, or direct MP4 URLs'
            },
            {
                key: 'gradient',
                label: 'Background Gradient',
                type: FIELD_TYPES.GRADIENT,
                showIf: { field: 'backgroundType', value: 'gradient' },
                default: {
                    type: 'linear',
                    angle: 135,
                    stops: [
                        { color: '#667eea', position: 0 },
                        { color: '#764ba2', position: 100 }
                    ]
                }
            },
            {
                key: 'parallax',
                label: 'Parallax Effect',
                type: FIELD_TYPES.OBJECT,
                fields: [
                    {
                        key: 'enabled',
                        label: 'Enable Parallax',
                        type: FIELD_TYPES.BOOLEAN,
                        default: false
                    },
                    {
                        key: 'speed',
                        label: 'Parallax Speed',
                        type: FIELD_TYPES.NUMBER,
                        min: 0,
                        max: 1,
                        step: 0.1,
                        default: 0.5,
                        showIf: { field: 'parallax.enabled', value: true }
                    }
                ]
            },
            {
                key: 'particles',
                label: 'Particle Effects',
                type: FIELD_TYPES.OBJECT,
                showIf: { field: 'backgroundType', value: 'particles' },
                fields: [
                    {
                        key: 'count',
                        label: 'Particle Count',
                        type: FIELD_TYPES.NUMBER,
                        min: 10,
                        max: 200,
                        default: 50
                    },
                    {
                        key: 'color',
                        label: 'Particle Color',
                        type: FIELD_TYPES.COLOR,
                        default: '#ffffff'
                    },
                    {
                        key: 'speed',
                        label: 'Animation Speed',
                        type: FIELD_TYPES.NUMBER,
                        min: 1,
                        max: 10,
                        default: 3
                    }
                ]
            },
            {
                key: 'overlay',
                label: 'Background Overlay',
                type: FIELD_TYPES.OBJECT,
                fields: [
                    {
                        key: 'enabled',
                        label: 'Enable Overlay',
                        type: FIELD_TYPES.BOOLEAN,
                        default: true
                    },
                    {
                        key: 'type',
                        label: 'Overlay Type',
                        type: FIELD_TYPES.SELECT,
                        options: [
                            { value: 'solid', label: 'Solid Color' },
                            { value: 'gradient', label: 'Gradient' }
                        ],
                        default: 'solid',
                        showIf: { field: 'overlay.enabled', value: true }
                    },
                    {
                        key: 'color',
                        label: 'Overlay Color',
                        type: FIELD_TYPES.COLOR,
                        default: '#000000',
                        showIf: { field: 'overlay.enabled', value: true }
                    },
                    {
                        key: 'opacity',
                        label: 'Overlay Opacity',
                        type: FIELD_TYPES.NUMBER,
                        min: 0,
                        max: 1,
                        step: 0.1,
                        default: 0.5,
                        showIf: { field: 'overlay.enabled', value: true }
                    }
                ]
            },
            {
                key: 'title',
                label: 'Title',
                type: FIELD_TYPES.OBJECT,
                fields: [
                    {
                        key: 'text',
                        label: 'Title Text',
                        type: FIELD_TYPES.TEXT,
                        default: 'Welcome to Our Store'
                    },
                    {
                        key: 'fontSize',
                        label: 'Font Size',
                        type: FIELD_TYPES.RESPONSIVE,
                        units: ['px', 'rem', 'em'],
                        default: { desktop: '4.5rem', tablet: '3rem', mobile: '2rem' }
                    },
                    {
                        key: 'fontFamily',
                        label: 'Font Family',
                        type: FIELD_TYPES.FONT,
                        default: 'inherit'
                    },
                    {
                        key: 'color',
                        label: 'Text Color',
                        type: FIELD_TYPES.COLOR,
                        default: '#ffffff'
                    },
                    {
                        key: 'fontWeight',
                        label: 'Font Weight',
                        type: FIELD_TYPES.SELECT,
                        options: [
                            { value: '300', label: 'Light' },
                            { value: '400', label: 'Normal' },
                            { value: '600', label: 'Semi-Bold' },
                            { value: '700', label: 'Bold' },
                            { value: '900', label: 'Black' }
                        ],
                        default: '700'
                    },
                    {
                        key: 'animation',
                        label: 'Animation',
                        type: FIELD_TYPES.ANIMATION,
                        default: { type: 'fade-up', duration: 800, delay: 0 }
                    }
                ]
            },
            {
                key: 'subtitle',
                label: 'Subtitle',
                type: FIELD_TYPES.OBJECT,
                fields: [
                    {
                        key: 'text',
                        label: 'Subtitle Text',
                        type: FIELD_TYPES.TEXTAREA,
                        default: ''
                    },
                    {
                        key: 'fontSize',
                        label: 'Font Size',
                        type: FIELD_TYPES.RESPONSIVE,
                        units: ['px', 'rem', 'em'],
                        default: { desktop: '1.5rem', tablet: '1.25rem', mobile: '1rem' }
                    },
                    {
                        key: 'color',
                        label: 'Text Color',
                        type: FIELD_TYPES.COLOR,
                        default: '#ffffff'
                    },
                    {
                        key: 'animation',
                        label: 'Animation',
                        type: FIELD_TYPES.ANIMATION,
                        default: { type: 'fade-up', duration: 800, delay: 200 }
                    }
                ]
            },
            {
                key: 'ctas',
                label: 'Call-to-Action Buttons',
                type: FIELD_TYPES.ARRAY,
                itemLabel: 'Button',
                max: 3,
                fields: [
                    {
                        key: 'text',
                        label: 'Button Text',
                        type: FIELD_TYPES.TEXT,
                        default: 'Shop Now'
                    },
                    {
                        key: 'link',
                        label: 'Button Link',
                        type: FIELD_TYPES.LINK,
                        default: '/products'
                    },
                    {
                        key: 'style',
                        label: 'Button Style',
                        type: FIELD_TYPES.SELECT,
                        options: [
                            { value: 'primary', label: '🔵 Primary' },
                            { value: 'secondary', label: '⚪ Secondary' },
                            { value: 'outline', label: '⭕ Outline' },
                            { value: 'ghost', label: '👻 Ghost' }
                        ],
                        default: 'primary'
                    },
                    {
                        key: 'icon',
                        label: 'Button Icon',
                        type: FIELD_TYPES.ICON,
                        default: 'arrow-right'
                    },
                    {
                        key: 'animation',
                        label: 'Animation',
                        type: FIELD_TYPES.ANIMATION,
                        default: { type: 'fade-up', duration: 800, delay: 400 }
                    }
                ],
                default: [
                    {
                        text: 'Shop Now',
                        link: '/products',
                        style: 'primary',
                        icon: 'arrow-right',
                        animation: { type: 'fade-up', duration: 800, delay: 400 }
                    }
                ]
            }
        ],
        templates: [
            {
                name: 'Modern Gradient',
                thumbnail: '/templates/hero-gradient.jpg',
                config: {
                    layout: 'centered',
                    backgroundType: 'gradient',
                    gradient: {
                        type: 'linear',
                        angle: 135,
                        stops: [
                            { color: '#667eea', position: 0 },
                            { color: '#764ba2', position: 100 }
                        ]
                    },
                    title: {
                        text: 'Shop the Latest Trends',
                        fontSize: { desktop: '4.5rem', tablet: '3rem', mobile: '2rem' },
                        color: '#ffffff'
                    }
                }
            },
            {
                name: 'Video Background',
                thumbnail: '/templates/hero-video.jpg',
                config: {
                    layout: 'centered',
                    backgroundType: 'video',
                    backgroundVideo: 'https://example.com/hero.mp4',
                    overlay: { enabled: true, opacity: 0.6 }
                }
            },
            {
                name: 'Particles Effect',
                thumbnail: '/templates/hero-particles.jpg',
                config: {
                    layout: 'centered',
                    backgroundType: 'particles',
                    particles: {
                        count: 100,
                        color: '#ffffff',
                        speed: 3
                    }
                }
            }
        ]
    },

    features: {
        label: 'Features Grid',
        icon: 'grid',
        category: WIDGET_CATEGORIES.CONTENT,
        description: 'Showcase key features or benefits with icons and descriptions',
        fields: [
            {
                key: 'layout',
                label: 'Layout Type',
                type: FIELD_TYPES.SELECT,
                options: [
                    { value: 'grid', label: '⊞ Grid' },
                    { value: 'carousel', label: '⟳ Carousel' },
                    { value: 'masonry', label: '⊟ Masonry' },
                    { value: 'timeline', label: '⟶ Timeline' }
                ],
                default: 'grid'
            },
            {
                key: 'columns',
                label: 'Columns',
                type: FIELD_TYPES.RESPONSIVE,
                min: 1,
                max: 6,
                default: { desktop: 4, tablet: 2, mobile: 1 }
            },
            {
                key: 'gap',
                label: 'Gap Between Items',
                type: FIELD_TYPES.SPACING,
                default: { x: '2rem', y: '2rem' }
            },
            {
                key: 'features',
                label: 'Features',
                type: FIELD_TYPES.ARRAY,
                itemLabel: 'Feature',
                fields: [
                    {
                        key: 'iconType',
                        label: 'Icon Type',
                        type: FIELD_TYPES.SELECT,
                        options: [
                            { value: 'lucide', label: '📦 Icon Library' },
                            { value: 'custom', label: '🖼️ Custom Image' },
                            { value: 'emoji', label: '😊 Emoji' }
                        ],
                        default: 'lucide'
                    },
                    {
                        key: 'iconName',
                        label: 'Icon',
                        type: FIELD_TYPES.ICON,
                        showIf: { field: 'iconType', value: 'lucide' },
                        default: 'star'
                    },
                    {
                        key: 'iconImage',
                        label: 'Custom Icon Image',
                        type: FIELD_TYPES.IMAGE,
                        showIf: { field: 'iconType', value: 'custom' },
                        default: ''
                    },
                    {
                        key: 'emoji',
                        label: 'Emoji',
                        type: FIELD_TYPES.TEXT,
                        showIf: { field: 'iconType', value: 'emoji' },
                        default: '⭐'
                    },
                    {
                        key: 'iconColor',
                        label: 'Icon Color',
                        type: FIELD_TYPES.COLOR,
                        default: '#3b82f6'
                    },
                    {
                        key: 'iconBackground',
                        label: 'Icon Background',
                        type: FIELD_TYPES.COLOR,
                        default: '#eff6ff'
                    },
                    {
                        key: 'iconSize',
                        label: 'Icon Size',
                        type: FIELD_TYPES.NUMBER,
                        units: ['px', 'rem'],
                        min: 24,
                        max: 96,
                        default: 48
                    },
                    {
                        key: 'title',
                        label: 'Feature Title',
                        type: FIELD_TYPES.TEXT,
                        default: 'Feature Title'
                    },
                    {
                        key: 'description',
                        label: 'Feature Description',
                        type: FIELD_TYPES.TEXTAREA,
                        default: 'Feature description goes here'
                    },
                    {
                        key: 'link',
                        label: 'Optional Link',
                        type: FIELD_TYPES.LINK,
                        default: ''
                    }
                ],
                default: [
                    {
                        iconType: 'lucide',
                        iconName: 'zap',
                        iconColor: '#3b82f6',
                        iconBackground: '#eff6ff',
                        title: 'Fast Delivery',
                        description: 'Quick shipping on all orders'
                    },
                    {
                        iconType: 'lucide',
                        iconName: 'shield',
                        iconColor: '#10b981',
                        iconBackground: '#d1fae5',
                        title: 'Secure Payment',
                        description: '100% secure transactions'
                    },
                    {
                        iconType: 'lucide',
                        iconName: 'headphones',
                        iconColor: '#8b5cf6',
                        iconBackground: '#ede9fe',
                        title: '24/7 Support',
                        description: 'Always here to help'
                    },
                    {
                        iconType: 'lucide',
                        iconName: 'award',
                        iconColor: '#f59e0b',
                        iconBackground: '#fef3c7',
                        title: 'Quality Guarantee',
                        description: 'Top-notch products only'
                    }
                ]
            },
            {
                key: 'cardStyle',
                label: 'Card Styling',
                type: FIELD_TYPES.OBJECT,
                fields: [
                    {
                        key: 'backgroundColor',
                        label: 'Background Color',
                        type: FIELD_TYPES.COLOR,
                        default: '#ffffff'
                    },
                    {
                        key: 'padding',
                        label: 'Padding',
                        type: FIELD_TYPES.SPACING,
                        default: '2rem'
                    },
                    {
                        key: 'borderRadius',
                        label: 'Border Radius',
                        type: FIELD_TYPES.NUMBER,
                        units: ['px', 'rem'],
                        default: 12
                    },
                    {
                        key: 'shadow',
                        label: 'Box Shadow',
                        type: FIELD_TYPES.SHADOW,
                        default: 'medium'
                    },
                    {
                        key: 'border',
                        label: 'Border',
                        type: FIELD_TYPES.BORDER,
                        default: { width: '1px', color: '#e5e7eb', style: 'solid' }
                    }
                ]
            },
            {
                key: 'hoverEffect',
                label: 'Hover Effect',
                type: FIELD_TYPES.SELECT,
                options: [
                    { value: 'none', label: 'None' },
                    { value: 'lift', label: '⬆️ Lift' },
                    { value: 'scale', label: '🔍 Scale' },
                    { value: 'glow', label: '✨ Glow' },
                    { value: 'tilt', label: '↻ Tilt' }
                ],
                default: 'lift'
            },
            {
                key: 'entranceAnimation',
                label: 'Entrance Animation',
                type: FIELD_TYPES.SELECT,
                options: [
                    { value: 'none', label: 'None' },
                    { value: 'fade', label: 'Fade In' },
                    { value: 'slide-up', label: '⬆️ Slide Up' },
                    { value: 'slide-left', label: '⬅️ Slide Left' },
                    { value: 'zoom', label: '🔍 Zoom In' }
                ],
                default: 'fade'
            },
            {
                key: 'staggerDelay',
                label: 'Stagger Delay (ms)',
                type: FIELD_TYPES.NUMBER,
                min: 0,
                max: 500,
                step: 50,
                default: 100,
                help: 'Delay between each item animation'
            },
            {
                key: 'sectionBackground',
                label: 'Section Background',
                type: FIELD_TYPES.OBJECT,
                fields: [
                    {
                        key: 'type',
                        label: 'Background Type',
                        type: FIELD_TYPES.SELECT,
                        options: [
                            { value: 'solid', label: 'Solid Color' },
                            { value: 'gradient', label: 'Gradient' },
                            { value: 'image', label: 'Image' }
                        ],
                        default: 'solid'
                    },
                    {
                        key: 'color',
                        label: 'Color',
                        type: FIELD_TYPES.COLOR,
                        showIf: { field: 'sectionBackground.type', value: 'solid' },
                        default: '#ffffff'
                    },
                    {
                        key: 'gradient',
                        label: 'Gradient',
                        type: FIELD_TYPES.GRADIENT,
                        showIf: { field: 'sectionBackground.type', value: 'gradient' }
                    },
                    {
                        key: 'image',
                        label: 'Background Image',
                        type: FIELD_TYPES.IMAGE,
                        showIf: { field: 'sectionBackground.type', value: 'image' }
                    }
                ]
            }
        ],
        templates: [
            {
                name: 'Classic 4-Column',
                config: {
                    layout: 'grid',
                    columns: { desktop: 4, tablet: 2, mobile: 1 }
                }
            },
            {
                name: 'Carousel Showcase',
                config: {
                    layout: 'carousel',
                    hoverEffect: 'scale'
                }
            }
        ]
    },

    stats: {
        label: 'Statistics Counter',
        icon: 'bar-chart',
        category: WIDGET_CATEGORIES.CONTENT,
        description: 'Animated number counters for showcasing achievements',
        fields: [
            {
                key: 'layout',
                label: 'Layout',
                type: FIELD_TYPES.SELECT,
                options: [
                    { value: 'horizontal', label: 'Horizontal' },
                    { value: 'vertical', label: 'Vertical' }
                ],
                default: 'horizontal'
            },
            {
                key: 'columns',
                label: 'Columns',
                type: FIELD_TYPES.RESPONSIVE,
                min: 1,
                max: 6,
                default: { desktop: 4, tablet: 2, mobile: 2 }
            },
            {
                key: 'stats',
                label: 'Statistics',
                type: FIELD_TYPES.ARRAY,
                itemLabel: 'Stat',
                fields: [
                    {
                        key: 'value',
                        label: 'Number Value',
                        type: FIELD_TYPES.NUMBER,
                        default: 1000
                    },
                    {
                        key: 'label',
                        label: 'Label',
                        type: FIELD_TYPES.TEXT,
                        default: 'Happy Customers'
                    },
                    {
                        key: 'prefix',
                        label: 'Prefix',
                        type: FIELD_TYPES.TEXT,
                        default: '',
                        help: 'e.g., $, €, #'
                    },
                    {
                        key: 'suffix',
                        label: 'Suffix',
                        type: FIELD_TYPES.TEXT,
                        default: '+',
                        help: 'e.g., +, %, K, M'
                    },
                    {
                        key: 'icon',
                        label: 'Icon',
                        type: FIELD_TYPES.ICON,
                        default: ''
                    },
                    {
                        key: 'iconColor',
                        label: 'Icon Color',
                        type: FIELD_TYPES.COLOR,
                        default: '#ffffff'
                    },
                    {
                        key: 'format',
                        label: 'Number Format',
                        type: FIELD_TYPES.SELECT,
                        options: [
                            { value: 'number', label: 'Number' },
                            { value: 'currency', label: 'Currency' },
                            { value: 'percentage', label: 'Percentage' }
                        ],
                        default: 'number'
                    },
                    {
                        key: 'decimals',
                        label: 'Decimal Places',
                        type: FIELD_TYPES.NUMBER,
                        min: 0,
                        max: 4,
                        default: 0
                    },
                    {
                        key: 'animationDuration',
                        label: 'Animation Duration (ms)',
                        type: FIELD_TYPES.NUMBER,
                        min: 500,
                        max: 5000,
                        step: 100,
                        default: 2000
                    }
                ],
                default: [
                    { value: 10000, label: 'Happy Customers', suffix: '+', icon: 'users' },
                    { value: 500, label: 'Products', suffix: '+', icon: 'package' },
                    { value: 50, label: 'Countries', suffix: '', icon: 'globe' },
                    { value: 99, label: 'Satisfaction', suffix: '%', icon: 'star' }
                ]
            },
            {
                key: 'textColor',
                label: 'Text Color',
                type: FIELD_TYPES.COLOR,
                default: '#ffffff'
            },
            {
                key: 'valueSize',
                label: 'Number Size',
                type: FIELD_TYPES.RESPONSIVE,
                units: ['px', 'rem'],
                default: { desktop: '4rem', tablet: '3rem', mobile: '2.5rem' }
            },
            {
                key: 'labelSize',
                label: 'Label Size',
                type: FIELD_TYPES.RESPONSIVE,
                units: ['px', 'rem'],
                default: { desktop: '1.25rem', tablet: '1rem', mobile: '0.875rem' }
            },
            {
                key: 'background',
                label: 'Section Background',
                type: FIELD_TYPES.OBJECT,
                fields: [
                    {
                        key: 'type',
                        label: 'Background Type',
                        type: FIELD_TYPES.SELECT,
                        options: [
                            { value: 'gradient', label: 'Gradient' },
                            { value: 'image', label: 'Image' },
                            { value: 'video', label: 'Video' },
                            { value: 'solid', label: 'Solid Color' }
                        ],
                        default: 'gradient'
                    },
                    {
                        key: 'gradient',
                        label: 'Gradient',
                        type: FIELD_TYPES.GRADIENT,
                        showIf: { field: 'background.type', value: 'gradient' },
                        default: {
                            type: 'linear',
                            angle: 45,
                            stops: [
                                { color: '#3b82f6', position: 0 },
                                { color: '#8b5cf6', position: 100 }
                            ]
                        }
                    },
                    {
                        key: 'image',
                        label: 'Background Image',
                        type: FIELD_TYPES.IMAGE,
                        showIf: { field: 'background.type', value: 'image' }
                    },
                    {
                        key: 'video',
                        label: 'Background Video',
                        type: FIELD_TYPES.VIDEO,
                        showIf: { field: 'background.type', value: 'video' }
                    },
                    {
                        key: 'overlay',
                        label: 'Overlay Settings',
                        type: FIELD_TYPES.OBJECT,
                        fields: [
                            {
                                key: 'enabled',
                                label: 'Enable Overlay',
                                type: FIELD_TYPES.BOOLEAN,
                                default: true
                            },
                            {
                                key: 'opacity',
                                label: 'Overlay Opacity',
                                type: FIELD_TYPES.NUMBER,
                                min: 0,
                                max: 1,
                                step: 0.1,
                                default: 0.7
                            }
                        ]
                    }
                ]
            },
            {
                key: 'separator',
                label: 'Separator Between Stats',
                type: FIELD_TYPES.OBJECT,
                fields: [
                    {
                        key: 'enabled',
                        label: 'Show Separator',
                        type: FIELD_TYPES.BOOLEAN,
                        default: true
                    },
                    {
                        key: 'color',
                        label: 'Separator Color',
                        type: FIELD_TYPES.COLOR,
                        default: 'rgba(255,255,255,0.2)'
                    },
                    {
                        key: 'width',
                        label: 'Separator Width',
                        type: FIELD_TYPES.NUMBER,
                        units: ['px'],
                        default: 1
                    }
                ]
            }
        ],
        templates: [
            {
                name: 'Blue Gradient',
                config: {
                    background: {
                        type: 'gradient',
                        gradient: {
                            type: 'linear',
                            angle: 45,
                            stops: [
                                { color: '#3b82f6', position: 0 },
                                { color: '#1e40af', position: 100 }
                            ]
                        }
                    }
                }
            }
        ]
    }
};

// Helper function to get schema for a widget type
export function getWidgetSchema(widgetType) {
    return WIDGET_SCHEMAS[widgetType] || null;
}

// Helper function to get all widget types by category
export function getWidgetsByCategory(category) {
    return Object.entries(WIDGET_SCHEMAS)
        .filter(([_, schema]) => schema.category === category)
        .map(([type, schema]) => ({ type, ...schema }));
}

// Helper function to get all categories
export function getAllCategories() {
    return Object.values(WIDGET_CATEGORIES);
}
