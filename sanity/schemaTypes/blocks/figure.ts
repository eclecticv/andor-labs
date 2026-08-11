import {defineField, defineType} from "sanity";

export const figure = defineType({
  name: "figure",
  title: "Figure",
  type: "object",
  fields: [
    defineField({
      name: "image",
      type: "image",
      options: {hotspot: true},
      validation: (r) => r.required(),
    }),
    defineField({
      name: "alt",
      title: "Alt text",
      type: "string",
      // Required, not encouraged: schema validation is the only place this can be
      // enforced before the image reaches a reader.
      description: "Describe the image for screen readers. Required.",
      validation: (r) => r.required(),
    }),
    defineField({name: "caption", type: "string"}),
    defineField({name: "credit", type: "string", description: "Source and licence, e.g. Openverse / CC BY."}),
    defineField({
      name: "dither",
      type: "boolean",
      // On by default because the house style is the Bayer duotone; the escape
      // hatch exists for screenshots, where dithering destroys legibility.
      initialValue: true,
      description: "Apply the house duotone dither. Turn off for screenshots and diagrams.",
    }),
  ],
  preview: {
    select: {caption: "caption", alt: "alt", media: "image"},
    prepare({caption, alt, media}) {
      return {title: caption || alt || "Figure", subtitle: "Figure", media};
    },
  },
});
