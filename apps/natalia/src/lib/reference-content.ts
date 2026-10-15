// Editorial content supplied in WEB NATALIA. It is not operational booking/payment configuration.
export const referenceServices = [
  {
    "id": 1,
    "slug": "consulta-integrativa-primera-vez",
    "title": "Consulta Médica Integrativa (Primera vez)",
    "modality": "Presencial o Virtual",
    "duration": "75 - 90 min",
    "price": "$38.000 ARS",
    "badge": "Historia clínica exhaustiva",
    "active": true,
    "shortDesc": "Historia clínica exhaustiva y plan inicial",
    "description": "Una primera consulta extensa para conocer tu historia desde el principio, revisar cada sistema del cuerpo y definir qué estudios bioquímicos avanzados necesitamos antes de iniciar el tratamiento.",
    "features": [
      "Interrogatorio exhaustivo desde el nacimiento y contexto afectivo/laboral",
      "Revisión clínica completa sistema por sistema y funciones cognitivas",
      "Pedido de laboratorio bioquímico ampliado (vitaminas, minerales, hormonas y marcadores de estrés)",
      "Definición de objetivos consensuados sin apuros ni relojes"
    ],
    "tags": [
      "Primera vez",
      "Panel bioquímico",
      "Sin reloj"
    ],
    "ctaText": "Reservar primera consulta"
  },
  {
    "id": 2,
    "slug": "consulta-seguimiento-evolucion",
    "title": "Consulta de Seguimiento y Evolución",
    "modality": "Presencial o Virtual",
    "duration": "50 min",
    "price": "$28.000 ARS",
    "badge": "Interpretación de laboratorio",
    "active": true,
    "shortDesc": "Evaluación de análisis clínicos y seguimiento",
    "description": "Lectura minuciosa de análisis clínicos, diseño de suplementación ortomolecular a medida, ajuste de hábitos posibles de sostener y articulación interdisciplinaria.",
    "features": [
      "Interpretación clínica integral del perfil bioquímico y metabólico",
      "Armado de plan individual de suplementación y principios activos",
      "Revisión de hábitos de descanso, alimentación y movimiento",
      "Integración con nutrición, psicología u osteopatía si corresponde"
    ],
    "tags": [
      "Laboratorio",
      "Suplementación",
      "Seguimiento"
    ],
    "ctaText": "Reservar seguimiento"
  },
  {
    "id": 3,
    "slug": "medicina-estres-regulacion-descanso",
    "title": "Medicina del Estrés y Regulación del Descanso",
    "modality": "Presencial o Virtual",
    "duration": "60 min",
    "price": "$32.000 ARS",
    "badge": "Enfoque PNIE y Cronobiología",
    "active": true,
    "shortDesc": "Abordaje de cronobiología, cortisol y descanso",
    "description": "Abordaje psiconeuroinmunoendocrinológico para personas que viven apagando incendios o con cansancio crónico. Regulación del reloj interno y señales biológicas de supervivencia.",
    "features": [
      "Evaluación de eje adrenal, cortisol y respuesta al estrés",
      "Estrategias de higiene circadiana, exposición a la luz y cronobiología",
      "Manejo de fatiga vespertina y despertares nocturnos sin descanso",
      "Adaptógenos y fitoterapia con respaldo científico"
    ],
    "tags": [
      "PNIE",
      "Sueño profundo",
      "Cronobiología"
    ],
    "ctaText": "Reservar consulta de estrés"
  },
  {
    "id": 4,
    "slug": "fitoterapia-microbiota-hongos",
    "title": "Fitoterapia, Hongos Medicinales y Microbiota",
    "modality": "Presencial o Virtual",
    "duration": "60 min",
    "price": "$32.000 ARS",
    "badge": "Fitomedicina y Salud Intestinal",
    "active": true,
    "shortDesc": "Fitomedicina clínica y salud digestiva",
    "description": "Tratamiento fitoterapéutico y micología funcional aplicada a la inflamación de bajo grado, salud digestiva, eje intestino-cerebro y modulación de la microbiota.",
    "features": [
      "Prescripción de formulación magistral y tinturas madre científicas",
      "Micología funcional: melena de león, reishi y hongos adaptógenos (SLF)",
      "Abordaje del eje intestino-cerebro, permeabilidad e hinchazón",
      "Estrategias naturales que respetan la fisiología individual"
    ],
    "tags": [
      "Fitomedicina",
      "Hongos funcionales",
      "Eje intestino-cerebro"
    ],
    "ctaText": "Reservar consulta de fitoterapia"
  }
] as const;
export const referenceArticles = {
  "1": {
    "title": "Dormir bien no empieza cuando apoyás la cabeza en la almohada",
    "category": "Sueño & Cronobiología",
    "serviceTarget": 3,
    "content": "\n      <p class=\"lead\">Muchas veces pensamos que dormir es un interruptor que apagamos de noche. Pero en realidad, el descanso de calidad se construye con las señales que le damos al cuerpo a lo largo de todo el día.</p>\n      \n      <h4>1. La luz de la mañana es el sincronizador principal</h4>\n      <p>El núcleo supraquiasmático —nuestro reloj biológico central— necesita recibir luz natural en las primeras horas tras despertar. Esa señal frena la producción de melatonina y programa el pico de cortisol para el arranque, asegurando que 14 a 16 horas después el cuerpo vuelva a liberar melatonina de forma natural.</p>\n\n      <h4>2. Pantallas, cafeína y la ilusión del agotamiento</h4>\n      <p>Cuando trabajamos hasta tarde bajo luces frías o con el celular en la cama, le estamos enviando al cerebro la señal biológica de que sigue siendo mediodía. Por eso, antes de pensar en suplementos o inductores del sueño, siempre conviene revisar los hábitos de base: horarios regulares, desconexión gradual y una cena que no sobrecargue la digestión.</p>\n\n      <h4>3. El sueño no se negocia</h4>\n      <p>Dormir bien no es un lujo ni un premio al final de una semana agotadora: es la base sobre la que funcionan el sistema inmune, la claridad mental y el equilibrio metabólico.</p>\n    "
  },
  "2": {
    "title": "Cuando el estrés deja de ser un momento y pasa a ser la rutina",
    "category": "Medicina del Estrés & PNIE",
    "serviceTarget": 1,
    "content": "\n      <p class=\"lead\">\"Vivo apagando incendios.\" Es una de las frases que más escucho en la consulta. Al principio parece que el cuerpo se la banca, hasta que un día empieza a pasar factura.</p>\n      \n      <h4>El modo supervivencia</h4>\n      <p>El estrés agudo es un mecanismo evolutivo brillante: prepara al cuerpo para huir o pelear. Pero cuando las demandas se vuelven crónicas, el sistema nervioso queda trabado en modo supervivencia.</p>\n      \n      <h4>¿Qué se resiente primero?</h4>\n      <p>El cuerpo es sabio: para sostener la alerta, ahorra energía en funciones que considera no indispensables para el minuto siguiente. Por eso los primeros síntomas suelen ser digestivos (hinchazón, cambios en el ritmo evacuatorio), hormonales (ciclos irregulares, caída de libido) o del sistema inmune (infecciones recurrentes o alergias).</p>\n\n      <h4>Escuchar antes de que grite</h4>\n      <p>Aprender a registrar estas señales a tiempo no es para alarmarse, sino para frenar la inercia y diseñar intervenciones que tengan sentido para cada persona.</p>\n    "
  },
  "3": {
    "title": "Somos un universo de conexiones",
    "category": "Medicina Integrativa",
    "serviceTarget": 1,
    "content": "\n      <p class=\"lead\">El cuerpo no funciona por partes ni en compartimentos estancos. Sin embargo, muchas personas pasan años saltando de especialista en especialista tratando cada síntoma por separado.</p>\n      \n      <h4>El síntoma es sólo el mensajero</h4>\n      <p>Una migraña recurrente puede tener su origen en un desequilibrio de la microbiota intestinal. Un insomnio persistente puede estar alimentado por una desregulación del eje adrenal o por déficits subclínicos de magnesio y vitamina D.</p>\n      \n      <h4>Una mirada que une las piezas</h4>\n      <p>La medicina integrativa no busca reemplazar la evidencia médica ni hacer promesas mágicas. Busca detenerse, escuchar la historia completa, analizar el laboratorio con criterio funcional y construir un plan que la persona realmente pueda sostener en su vida cotidiana.</p>\n    "
  }
} as const;
