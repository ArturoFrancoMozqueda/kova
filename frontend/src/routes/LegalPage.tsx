import { useEffect } from "react";
import { Link } from "react-router-dom";
import Logo from "@/components/brand/Logo";
import { SUPPORT_EMAIL } from "@/lib/support";

const PROVIDER_TRADE_NAME = "Kovasuite";

type LegalPageProps = {
  variant: "privacy" | "terms" | "security" | "cookies";
};

type SectionContent = {
  heading: string;
  body: string[];
};

type VariantContent = {
  eyebrow: string;
  title: string;
  intro: string;
  lastUpdated: string;
  sections: SectionContent[];
};

const content: Record<LegalPageProps["variant"], VariantContent> = {
  privacy: {
    eyebrow: "Legal · Versión 1.3",
    title: "Aviso de privacidad integral",
    intro:
      "Este aviso describe qué datos personales tratamos al prestar el servicio, para qué los utilizamos y cómo solicitar su acceso, corrección o eliminación. Incluye el tratamiento asociado a WhatsApp cuando un negocio autoriza esa conexión.",
    lastUpdated: "18 de noviembre de 2026",
    sections: [
      {
        heading: "I. Propósito de este documento",
        body: [
          "Este aviso se aplica a los datos de las cuentas de Kova y a los que los negocios registran para operar el servicio. La sección de WhatsApp describe únicamente la conexión que un negocio autorice; este aviso no activa esa función ni sustituye el aviso que cada negocio debe proporcionar a sus propios clientes.",
        ],
      },
      {
        heading: "II. Responsable y contacto",
        body: [
          `El servicio Kova se presta bajo el nombre comercial ${PROVIDER_TRADE_NAME}. Para asuntos relacionados con el tratamiento de datos personales, derechos ARCO, revocación del consentimiento o dudas sobre este Aviso de Privacidad, puedes comunicarte a ${SUPPORT_EMAIL}.`,
        ],
      },
      {
        heading: "III. Datos personales que se recaban",
        body: [
          "2.1 Datos de identificación y contacto:",
          "• Correo electrónico.",
          "• Nombre del negocio.",
          "• Contraseña.",
          "2.2 Datos financieros y de pago:",
          "• Datos de medios de pago (tarjeta de crédito/débito procesados por proveedores certificados PCI-DSS).",
          "• Historial de transacciones comerciales dentro de la plataforma.",
          "2.3 Datos técnicos y de uso:",
          "• Dirección IP.",
          "• Navegador.",
          "• Datos de uso y analytics de la plataforma.",
          "• Cookies (ver Política de Cookies).",
          "2.4 Contenido generado por el usuario:",
          "• Imágenes y fotografías de productos subidas voluntariamente.",
          "• Catálogos, inventarios y descripciones de productos.",
          "• Registros de ventas, reportes y datos operacionales del negocio.",
          "2.5 Datos de la conexión con WhatsApp y Meta, cuando el negocio la autoriza:",
          "• Identificadores de la cuenta de WhatsApp del negocio y del número comercial autorizado, estado de la conexión y permisos de atención.",
          "• Números de contacto, texto de mensajes recibidos y borradores o respuestas del negocio, identificadores y tipos de mensaje, fechas y estados de envío, entrega o lectura que Meta comunique.",
          "• Credenciales de autorización de la conexión, almacenadas cifradas en el servidor. Los códigos temporales de autorización se usan para completar la conexión y no forman parte de la exportación del negocio.",
          "• Si el dueño autoriza conservar su número en WhatsApp Business mediante coexistencia: contactos e historial de la cuenta comercial que Meta permita compartir, y mensajes enviados desde la app del celular para reflejarlos en la bandeja de Kova. El dueño puede rechazar compartir el historial en Meta.",
          "La integración sólo recibe los datos de la cuenta comercial autorizada que Meta entregue; no accede a otras cuentas del teléfono ni descarga imágenes, audios, videos o documentos recibidos por WhatsApp. Puede conservar el tipo de un mensaje sin guardar su archivo.",
          "2.6 Datos que no solicitamos de forma obligatoria para crear una cuenta:",
          "• Datos biométricos.",
          "• Datos de salud.",
          "• Orientación sexual, religión, opiniones políticas u origen racial.",
          "• Fecha de nacimiento.",
          "• Dirección física del usuario.",
          "El texto que una persona incluya voluntariamente en una conversación puede contener información adicional. Evita enviar datos sensibles o información que no sea necesaria para la atención del negocio.",
        ],
      },
      {
        heading: "IV. Finalidades del tratamiento",
        body: [
          "3.1 Finalidades primarias (necesarias para la relación contractual):",
          "1. Crear, verificar y administrar la cuenta del usuario en la plataforma Kova.",
          "2. Enviar correos transaccionales (verificación, facturación, recuperación de cuenta).",
          "3. Enviar notificaciones técnicas, actualizaciones de servicio y alertas de seguridad.",
          "4. Dar atención a solicitudes de soporte técnico y servicio al cliente.",
          "5. Cumplir obligaciones legales, fiscales o regulatorias aplicables.",
          "6. Cuando el negocio autorice WhatsApp: conectar su cuenta y número comercial, recibir conversaciones, permitir respuestas confirmadas por su personal autorizado y consultar los estados de entrega. Los mensajes de este flujo no se utilizan para publicidad, venta de datos ni entrenamiento de modelos de inteligencia artificial.",
          "3.2 Finalidades secundarias (puede revocar en cualquier momento):",
          "7. Enviar comunicaciones de marketing, novedades y promociones de Kova.",
          "8. Realizar encuestas de satisfacción y estudios de mercado.",
          "9. Analizar el uso de la plataforma para mejorar funcionalidades.",
          "10. Compartir contenido de éxito o casos de uso (siempre con consentimiento expreso y de forma anonimizada).",
          `Si usted no desea que sus datos sean tratados para las finalidades secundarias, puede comunicarlo a ${SUPPORT_EMAIL} sin que ello afecte su acceso al servicio.`,
        ],
      },
      {
        heading: "V. Derechos ARCO y mecanismos de ejercicio",
        body: [
          "Usted tiene derecho a:",
          "• ACCESO: Conocer qué datos personales tenemos de usted y cómo los tratamos.",
          "• RECTIFICACIÓN: Corregir datos inexactos o incompletos.",
          "• CANCELACIÓN: Solicitar la eliminación de sus datos cuando no sean necesarios.",
          "• OPOSICIÓN: Oponerse al tratamiento de sus datos para finalidades secundarias.",
          "• PORTABILIDAD (principio GDPR aplicable): Recibir sus datos en formato estructurado.",
          "• REVOCACIÓN DEL CONSENTIMIENTO: Retirar su consentimiento para tratamientos no esenciales.",
          `Puede descargar los datos de su negocio y programar la eliminación de su cuenta desde Configuración. También puede ejercer sus derechos enviando una solicitud a ${SUPPORT_EMAIL} con asunto “Derechos ARCO” indicando: nombre completo, descripción del derecho a ejercer, documentación que acredite su identidad, y el dato o tratamiento sobre el que ejerce el derecho. Responderemos en un plazo máximo de 20 días hábiles conforme a la LFPDPPP.`,
        ],
      },
      {
        heading: "VI. WhatsApp, Meta y proveedores del servicio",
        body: [
          "El negocio decide conectar su cuenta de WhatsApp y es responsable de contar con una base legítima para contactar a sus clientes y del contenido que envía. Kova trata las conversaciones por cuenta de ese negocio para prestar la función de atención autorizada. Su personal sólo accede conforme a los permisos del negocio y de la sucursal correspondientes.",
          "Cuando la cuenta sea compatible y el dueño lo autorice, la coexistencia permite conservar el número y seguir usando WhatsApp Business en el celular. Kova importa los datos comerciales autorizados para consultar conversaciones y reflejar la atención del negocio. Los contactos importados se mantienen separados del CRM y no se convierten automáticamente en clientes ni en consentimiento para enviar mensajes. El historial y los mensajes enviados desde el celular no autorizan por sí solos nuevas respuestas desde Kova.",
          "Meta y WhatsApp intervienen en la autorización de la cuenta y en el transporte y los estados de los mensajes, conforme a sus propias condiciones y avisos de privacidad. Para alojar y operar Kova utilizamos Cloudflare y Supabase como proveedores de infraestructura. El tratamiento puede realizarse fuera de México; no ofrecemos almacenamiento exclusivo en México.",
          "Los datos de WhatsApp se comparten con estos proveedores sólo en lo necesario para operar la conexión, alojar la información y proteger el servicio. No se venden ni se comparten con anunciantes para crear perfiles publicitarios.",
          "La conexión utiliza comunicaciones HTTPS, control de acceso por negocio y sucursal y credenciales cifradas en el servidor. No compartas contraseñas, códigos de autorización ni tokens por correo o en una conversación de soporte.",
        ],
      },
      {
        heading: "VII. Solicitudes de eliminación de datos de WhatsApp y Meta",
        body: [
          `Para retirar la autorización de Kova, utiliza las opciones de permisos e integraciones de tu cuenta en Meta. Pausar respuestas o retirar permisos no elimina automáticamente el historial ya guardado en Kova. Para solicitar la eliminación de datos de WhatsApp o Meta, escribe a ${SUPPORT_EMAIL} con el asunto “Eliminar datos de WhatsApp”, indica el negocio y el número o conversación correspondientes. Verificaremos tu identidad y, cuando corresponda, tu representación del negocio antes de atender la solicitud. No envíes tokens ni contraseñas.`,
          "Si eres cliente de un negocio que usa Kova, puedes dirigir tu solicitud al propio negocio o escribir al canal anterior para que podamos identificar el tratamiento correspondiente. Las solicitudes se atienden conforme a la sección de derechos de este aviso y las obligaciones de conservación aplicables. La eliminación en Kova no borra copias conservadas por el negocio, los destinatarios o Meta y WhatsApp bajo sus propias políticas.",
        ],
      },
      {
        heading: "VIII. Retención y eliminación de datos",
        body: [
          "• Mientras la cuenta permanezca activa en la plataforma.",
          "• La eliminación de la cuenta del negocio se programa con un plazo reversible de al menos 30 días, extendido si un periodo ya pagado termina después. Ese plazo no sustituye los mecanismos ni los plazos legales para ejercer derechos sobre datos personales.",
          "• Al purgar la cuenta se eliminan sus datos activos y se conserva una constancia mínima del estado y fechas de la solicitud. Los respaldos pueden conservar una copia hasta 7 días adicionales conforme a la retención vigente.",
          "• Cualquier conservación excepcional para cumplir una obligación legal o atender una reclamación requiere su propio fundamento y alcance. No se presume una retención indefinida por defecto ni un periodo fiscal uniforme para toda la información del negocio.",
          "Las conversaciones de WhatsApp, sus estados, los contactos importados y los datos de conexión forman parte de los datos del negocio sujetos a estas reglas. No se borran al cerrar una conversación ni al pausar respuestas. La exportación del negocio incluye el texto, el origen y los estados de sus mensajes y los contactos importados; excluye las credenciales de conexión y los códigos de autorización. La purga de una cuenta comprende también su historial, sus contactos importados y sus credenciales de WhatsApp, salvo la información que deba conservarse por una obligación aplicable.",
          "La eliminación en Kova no borra automáticamente las copias que el negocio, los destinatarios o los proveedores conserven conforme a sus propias obligaciones y avisos. Los datos que dejen de ser necesarios se suprimen o disocian conforme a las obligaciones aplicables.",
        ],
      },
      {
        heading: "IX. Menores de edad",
        body: [
          "Kova está dirigida exclusivamente a personas mayores de 18 años. El registro, acceso y uso de la plataforma únicamente está permitido a usuarios que cuenten con capacidad legal suficiente para contratar y utilizar los servicios ofrecidos por Kova.",
        ],
      },
      {
        heading: "X. Cambios al aviso de privacidad",
        body: [
          "Los cambios materiales a este Aviso de Privacidad se comunicarán mediante su publicación, correo electrónico o aviso al iniciar sesión, según corresponda. Si una nueva finalidad o tratamiento requiere consentimiento expreso, continuar usando el servicio no sustituye ese consentimiento. Los derechos y obligaciones legales conservan su alcance.",
        ],
      },
    ],
  },
  terms: {
    eyebrow: "Legal · Versión 1.3",
    title: "Términos y condiciones de uso",
    intro:
      "Estos términos explican las condiciones para usar Kova, contratar una suscripción y administrar los datos de tu negocio. Revísalos antes de crear tu cuenta o confirmar un pago. Los acuerdos particulares vigentes y los derechos que la ley te reconoce conservan su alcance.",
    lastUpdated: "18 de noviembre de 2026",
    sections: [
      {
        heading: "1. Prestador, servicio y personas usuarias",
        body: [
          `Kova es un servicio de punto de venta y administración comercial ofrecido bajo el nombre comercial ${PROVIDER_TRADE_NAME}. El canal de contacto para este servicio es ${SUPPORT_EMAIL}.`,
          "El servicio funciona en el navegador de una computadora, tablet o teléfono compatible. Su instalación como aplicación web depende de las capacidades del navegador y del dispositivo.",
          "La persona propietaria administra la cuenta del negocio, sus usuarios y permisos. Si actúas por un negocio o por otra persona, debes contar con autorización para representarlos y para registrar su información.",
        ],
      },
      {
        heading: "2. Aceptación y requisitos de uso",
        body: [
          "Para contratar debes ser mayor de 18 años, tener capacidad legal y proporcionar información veraz. El registro requiere la aceptación expresa de los términos y la puesta a disposición del Aviso de privacidad y la Política de cookies.",
          "Crear una cuenta de prueba no autoriza cargos ni equivale a contratar una suscripción pagada. Los cobros recurrentes requieren una autorización expresa e informada al contratar.",
          "La persona propietaria debe informar a su equipo sobre estas condiciones y sobre las responsabilidades de cada rol. La aceptación de estos términos no sustituye el consentimiento que corresponda para otros tratamientos o servicios.",
        ],
      },
      {
        heading: "3. Cuenta y seguridad",
        body: [
          "Cada persona debe usar su propio usuario y mantener sus credenciales confidenciales. La persona propietaria elige los accesos de su equipo y debe retirarlos cuando dejen de ser necesarios.",
          `Si sospechas de un acceso no autorizado, notifícalo a ${SUPPORT_EMAIL}. Soporte no te pedirá contraseñas, códigos de acceso ni datos completos de tarjeta.`,
          "Podemos restringir accesos para atender riesgos de seguridad o usos contrarios a estas condiciones y comunicar las medidas cuando sea posible y legalmente permitido. Una restricción de acceso no equivale por sí misma a eliminar los datos del negocio ni autoriza su uso para otros fines.",
        ],
      },
      {
        heading: "4. Funciones y alcance del servicio",
        body: [
          "Kova permite registrar ventas y sus métodos de pago, administrar productos e inventario, operar turnos y consultar reportes. Las funciones adicionales, límites y condiciones disponibles para tu negocio dependen del plan contratado, los permisos y la configuración que se informe al contratar.",
          "Los pagos que tus clientes hacen en el mostrador se registran como operaciones del negocio. Kova no es una terminal bancaria ni procesa ese dinero. La terminal o el medio de cobro se contrata por separado.",
          "Registrar un pedido, una tarea o un seguimiento no cobra al cliente, paga al proveedor ni envía un mensaje por sí mismo. Las integraciones externas requieren disponibilidad, habilitación y autorización específicas. El enlace de contacto por WhatsApp no acredita una integración de WhatsApp en el POS.",
          "Los recibos de venta de Kova no son facturas ni CFDI. Puedes configurar una tasa de impuesto adicional para la venta; Kova no determina IVA o IEPS por producto ni sustituye tu proceso fiscal o contable. La oferta inicial no incluye emisión de CFDI ni una terminal bancaria integrada.",
          "La caja sin conexión requiere preparar el catálogo y abrir el turno con conexión, además de una sesión y acceso comercial vigentes. Algunas funciones necesitan internet. Conserva las ventas pendientes hasta que la aplicación confirme su sincronización; borrar el almacenamiento del navegador o perder el dispositivo puede impedir su recuperación.",
          "La impresión usa el navegador y el controlador del equipo. La compatibilidad de impresoras, lectores, cajones y otros dispositivos debe comprobarse con el modelo concreto antes de incorporarlos a tu operación.",
          "Kova se ofrece en una etapa beta controlada con acompañamiento. No existe un SLA formal de disponibilidad o resolución durante esta etapa.",
        ],
      },
      {
        heading: "5. Planes, prueba y cobros recurrentes",
        body: [
          "La oferta vigente para nuevas contrataciones es Esencial por $399 MXN al mes o Gestión por $699 MXN al mes, con impuestos incluidos. Antes de pagar, revisa el catálogo disponible para tu negocio, sus funciones y límites, el importe final, la periodicidad y las fechas de cobro informadas en la contratación y en Facturación.",
          "Los acuerdos Standard anteriores de $299 MXN al mes conservan las condiciones expresamente pactadas. Su importe y alcance no se sustituyen automáticamente por los de Esencial o Gestión.",
          "La prueba de una cuenta nueva dura 7 días y no requiere tarjeta. Al terminar, debes contratar un plan para conservar las funciones operativas. La prueba no se convierte en un cobro automático por el solo hecho de crear la cuenta.",
          "Las suscripciones pagadas son mensuales y tienen renovación automática hasta su cancelación. Los cargos se procesan mediante Stripe conforme al importe y periodicidad autorizados. Kova no recibe ni almacena los datos completos de la tarjeta usada para la suscripción.",
          "Cuando resulte aplicable la normativa de protección al consumidor, tienes derecho al aviso de renovación automática con al menos cinco días naturales de anticipación y a cancelar sin penalización mediante un mecanismo accesible. Estos términos no eliminan esos derechos ni sustituyen el consentimiento expreso requerido para un cobro recurrente.",
        ],
      },
      {
        heading: "6. Confirmación de pago y acceso",
        body: [
          "El acceso pagado se confirma a partir del estado verificado del pago y la suscripción. Volver de la página de pago o ver un recibo de un periodo anterior no acredita por sí solo que la suscripción siga vigente.",
          "Si un pago falla, las funciones operativas pueden quedar restringidas. Cuando existe un periodo de gracia verificado, dura como máximo 48 horas desde el primer intento fallido. Al terminar, debes recuperar el pago de la suscripción existente desde Facturación.",
          "La recuperación de facturación, la exportación de datos y la solicitud de eliminación de la cuenta permanecen disponibles para la persona propietaria autenticada, aunque falte acceso comercial por pago. La restricción por falta de pago no elimina automáticamente la cuenta ni sus registros.",
          `Si el pago o la renovación aparecen pendientes de verificación, consulta el estado en Facturación o escribe a ${SUPPORT_EMAIL} antes de repetir el pago.`,
        ],
      },
      {
        heading: "7. Cancelación de renovación y revisión de cargos",
        body: [
          "Puedes cancelar la renovación desde Facturación mediante las opciones de cancelación o el Portal de Stripe disponible para tu cuenta. No hay plazo forzoso ni penalización por cancelar. La confirmación muestra el estado y, cuando corresponda, la fecha hasta la que se conserva el periodo pagado verificado.",
          "Cancelar la renovación no elimina la cuenta ni constituye una solicitud de borrar sus datos. Puedes exportar la información del negocio por separado y conservar el acceso correspondiente al periodo ya pagado y verificado.",
          `La cancelación no genera por sí sola un reembolso automático. Si detectas un cargo no autorizado, duplicado o incorrecto, o necesitas solicitar una devolución, escribe a ${SUPPORT_EMAIL}. La solicitud se atiende conforme a las circunstancias, los acuerdos aplicables y tus derechos legales; esta cláusula no establece una renuncia a reembolsos o compensaciones que procedan.`,
        ],
      },
      {
        heading: "8. Contenido del negocio y propiedad intelectual",
        body: [
          "Conservas los derechos que te correspondan sobre los datos, imágenes y demás contenido que registras. Debes contar con los derechos y autorizaciones necesarios para usarlos, incluidos los datos personales de clientes y empleados.",
          "Autorizas únicamente el almacenamiento, procesamiento, presentación y respaldo de ese contenido necesarios para prestar y proteger el servicio. Los proveedores que intervengan quedan sujetos a los alcances y condiciones descritos en el Aviso de privacidad. Este permiso no autoriza vender tus datos ni usar tus imágenes para publicidad sin la autorización correspondiente.",
          "Los derechos sobre el software, diseño y marca de Kova corresponden a sus titulares o licenciantes. Los componentes de terceros conservan sus propias licencias. La suscripción concede acceso al servicio y no transfiere la propiedad del software.",
        ],
      },
      {
        heading: "9. Uso permitido y disponibilidad",
        body: [
          "Debes usar el servicio para actividades lícitas. Está prohibido intentar acceder a otros negocios, eludir controles de seguridad o permisos, introducir software malicioso, sobrecargar deliberadamente el servicio, infringir derechos de terceros o tratar datos sin las autorizaciones necesarias.",
          "La disponibilidad puede depender de conectividad, dispositivos, mantenimiento y proveedores externos. Atendemos los incidentes conforme al alcance contratado y a las obligaciones aplicables; la referencia a terceros o a fallas de red no constituye una exoneración general de responsabilidad.",
          "Los mantenimientos programados que impliquen interrupciones se comunicarán con al menos 24 horas de anticipación, salvo emergencias técnicas. Durante la beta no se garantiza disponibilidad ininterrumpida ni un tiempo máximo de resolución.",
        ],
      },
      {
        heading: "10. Exportación, eliminación y conservación",
        body: [
          "La persona propietaria puede descargar una exportación del negocio desde Configuración, con los archivos y metadatos disponibles para su cuenta. Se excluyen credenciales, sesiones e información interna de seguridad y operación. La descarga requiere conexión y autenticación.",
          "La eliminación del negocio es una acción distinta de cancelar la renovación. Se solicita desde Configuración, confirmando la contraseña actual y el nombre del negocio. Se programa con un plazo reversible de al menos 30 días, que se extiende si el periodo ya pagado termina después.",
          "Puedes cancelar la solicitud de eliminación durante ese plazo. Cancelar esa solicitud no equivale a reactivar la renovación de una suscripción que ya se hubiera cancelado; revisa su estado en Facturación.",
          "La purga elimina los datos activos del negocio y conserva una constancia mínima del estado y fechas de la solicitud, sin conservar su información operativa en esa constancia. Los accesos que correspondan a otros negocios se administran por separado.",
          "Los respaldos diarios pueden conservar una copia hasta 7 días adicionales después de la purga, conforme a la retención vigente. Las obligaciones legales de conservación requieren su propio fundamento y tratamiento; no se presume una retención indefinida por defecto. La eliminación en Kova no elimina automáticamente información conservada por terceros conforme a sus propias obligaciones y avisos.",
          `La exportación o eliminación de toda la cuenta no sustituye las solicitudes sobre datos personales. Puedes ejercer tus derechos o pedir asistencia en ${SUPPORT_EMAIL} conforme al Aviso de privacidad.`,
        ],
      },
      {
        heading: "11. Soporte y comunicación",
        body: [
          `El correo público de soporte es ${SUPPORT_EMAIL}. Las respuestas de atención pueden llegar desde posprojectsupport@gmail.com.`,
          "El horario publicado es de lunes a viernes, de 9:00 a 19:00, hora de Ciudad de México. Los incidentes que impiden operar tienen prioridad; no se promete un plazo fijo de respuesta o resolución ni atención permanente durante la beta.",
          "Los reportes de errores, acceso indebido o contenido contrario a estas condiciones se reciben por ese canal. Al reportar un problema, comparte sólo el contexto necesario y evita datos sensibles o información de terceros que no sea indispensable.",
        ],
      },
      {
        heading: "12. Acuerdos particulares y derechos",
        body: [
          "Estos términos se complementan con el Aviso de privacidad, la Política de cookies y las condiciones particulares expresamente acordadas para el negocio. No sustituyen por sí solos las condiciones vigentes de acuerdos Standard anteriores ni modifican retroactivamente periodos ya pagados.",
          "Si una disposición resulta inválida o inaplicable, las demás conservan su alcance en lo que permita la ley. La falta de ejercicio de un derecho no implica por sí sola su renuncia.",
          "Las limitaciones descritas no eliminan los derechos irrenunciables que correspondan en materia de consumo, privacidad, datos personales u otras normas obligatorias. No se exige renunciar a ellos para utilizar Kova.",
        ],
      },
      {
        heading: "13. Ley aplicable y solución de controversias",
        body: [
          `Para aclaraciones o controversias puedes contactar primero a ${SUPPORT_EMAIL}, sin que ello limite tu acceso a las autoridades o medios de reclamación que te correspondan.`,
          "La relación se rige por las leyes aplicables de los Estados Unidos Mexicanos. La competencia de autoridades y tribunales se determina conforme a las reglas legales que correspondan; estos términos no imponen una renuncia a derechos o medios de defensa irrenunciables.",
        ],
      },
      {
        heading: "14. Cambios a estas condiciones",
        body: [
          "La fecha de actualización identifica esta versión del documento. Los cambios materiales aplicables a acuerdos vigentes se notificarán con al menos 15 días de anticipación y no se aplicarán retroactivamente a periodos ya pagados.",
          "El uso posterior del servicio no sustituye un consentimiento expreso cuando éste sea exigible, en especial para cobros recurrentes. Si no aceptas un cambio, puedes cancelar la renovación y exportar tus datos; no se exige eliminar la cuenta como única alternativa. Los derechos legales y acuerdos particulares vigentes conservan su protección.",
        ],
      },
    ],
  },
  security: {
    eyebrow: "Seguridad",
    title: "Cómo protegemos tu negocio",
    intro:
      "Kova maneja la operación de tu PyME: ventas, inventario, turnos, y datos de tus clientes. Esta página explica con honestidad cómo cuidamos esa información durante la beta y qué puedes esperar de nosotros.",
    lastUpdated: "18 de noviembre de 2026",
    sections: [
      {
        heading: "Aislamiento por inquilino",
        body: [
          "Cada negocio (tenant) en Kova vive en un espacio lógico aislado. La API valida la sesión y establece el negocio activo antes de consultar datos.",
          "Además, PostgreSQL aplica Row-Level Security (RLS) a las tablas con datos de cada negocio. El backend de producción debe iniciar con un rol sin privilegios para evadir RLS; si esa postura no se cumple, el arranque se detiene.",
        ],
      },
      {
        heading: "Sesiones y cookies",
        body: [
          "La sesión usa cookies HttpOnly para que las credenciales no estén disponibles para el JavaScript de la página. En producción también se envían sólo por HTTPS y con una política SameSite; no guardamos credenciales en localStorage.",
          "Las peticiones que cambian información requieren una comprobación CSRF adicional. Los webhooks de Stripe siguen un control distinto y se validan con la firma del proveedor.",
          "Contraseñas: se almacenan con hash bcrypt; nunca en texto plano.",
        ],
      },
      {
        heading: "Respaldos y recuperación",
        body: [
          "Kova mantiene un proceso programado para crear un respaldo lógico diario y conservarlo por 7 días en almacenamiento separado. Cada ejecución valida que el archivo se haya subido; una falla queda visible en el sistema de automatización.",
          "Las pruebas con respaldos reales han verificado la restauración lógica, la integridad y el acceso a una copia aislada. Falta completar y medir la recuperación del servicio ante una falla regional, incluido el cambio de tráfico. Estas pruebas no garantizan un tiempo máximo de recuperación ni una pérdida máxima de datos.",
        ],
      },
      {
        heading: "Monitoreo de disponibilidad",
        body: [
          "Monitoreamos tres puntos críticos con UptimeRobot: el frontend (kovasuite.com), la API (api.kovasuite.com/health) y la API + base (api.kovasuite.com/health/db).",
          "Los monitores consultan esos puntos cada 5 minutos y alertan después de confirmar una falla. No ofrecemos un SLA formal durante la beta controlada con acompañamiento.",
        ],
      },
      {
        heading: "Separación de pagos",
        body: [
          "Kova no procesa los pagos que tus clientes hacen en tu mostrador. Esos cobros (efectivo, transferencia, tarjeta manual) se registran en el POS, pero el dinero nunca pasa por Kova.",
          "Lo único que cobra Kova es tu suscripción mensual al SaaS, y ese cargo lo procesa Stripe directamente. Kova nunca recibe ni almacena los datos de tu tarjeta: Stripe los tokeniza.",
        ],
      },
      {
        heading: "Lo que esperamos de ti",
        body: [
          "Usa contraseñas largas (12+ caracteres) y únicas. Si compartes acceso con tu equipo, dales su propio usuario en Configuración → Empleados con el rol mínimo necesario.",
          "Cierra sesión al terminar el turno en equipos compartidos. La sesión expira sola, pero el cierre explícito es más rápido.",
          `Avísanos de cualquier comportamiento extraño en ${SUPPORT_EMAIL} con el asunto 'Seguridad Kova'.`,
        ],
      },
      {
        heading: "Qué esperar como tenant en beta",
        body: [
          "Estamos en beta controlada con acompañamiento. Esto significa: estabilidad sobre cantidad de funciones, despliegues frecuentes con pruebas, contacto directo con el equipo y compromiso de comunicar cualquier incidente que afecte tu operación.",
          "No garantizamos disponibilidad ininterrumpida durante la beta. Kova incluye modo offline para que la caja siga funcionando si la red falla.",
          "Si descubres una vulnerabilidad, escríbenos antes de divulgarla públicamente. Coordinaremos un parche y te reconoceremos el reporte.",
        ],
      },
      {
        heading: "Soporte",
        body: [
          `Canal único durante beta: ${SUPPORT_EMAIL}. Respondemos en horario hábil de México (lun-vie, 9:00 a 19:00 CDMX). Incidentes que rompan tu operación se atienden con prioridad alta.`,
        ],
      },
    ],
  },
  cookies: {
    eyebrow: "Legal · Versión 1.0",
    title: "Política de cookies y tecnologías de rastreo",
    intro:
      "Gestión de consentimiento, cookies de terceros y analytics. Kova utiliza cookies y tecnologías similares para permitir el funcionamiento de la plataforma, mantener sesiones activas, recordar preferencias, mejorar la seguridad, analizar el uso del servicio y optimizar la experiencia del usuario.",
    lastUpdated: "28 de mayo de 2026 (fecha de entrada en vigor)",
    sections: [
      {
        heading: "Qué son las cookies",
        body: [
          "Las cookies son pequeños archivos o identificadores que se almacenan en el dispositivo del usuario cuando visita o utiliza una plataforma digital. Además de cookies, Kova puede utilizar tecnologías como almacenamiento local, identificadores de dispositivo, píxeles o herramientas de análisis.",
        ],
      },
      {
        heading: "Tipos de cookies que podemos utilizar",
        body: [
          "Kova puede utilizar las siguientes categorías:",
          "• Cookies necesarias: permiten funciones básicas como inicio de sesión, seguridad, autenticación y operación de la plataforma. Estas cookies no pueden desactivarse desde Kova, ya que son necesarias para prestar el servicio.",
          "• Cookies de preferencias: permiten recordar configuraciones del usuario, como idioma, vista, tema visual u otras preferencias de uso.",
          "• Cookies analíticas: ayudan a entender cómo se utiliza la plataforma, medir rendimiento, detectar errores y mejorar el servicio. Estas cookies pueden provenir de herramientas propias o de terceros.",
          "• Cookies de marketing: actualmente Kova no utiliza cookies de publicidad personalizada. En caso de implementarlas, se solicitará el consentimiento correspondiente cuando sea requerido por la legislación aplicable.",
        ],
      },
      {
        heading: "Cookies de terceros",
        body: [
          "Kova puede integrar servicios de terceros, como herramientas de analítica, procesamiento de pagos, soporte o monitoreo técnico. Estos proveedores pueden utilizar cookies o tecnologías similares conforme a sus propias políticas de privacidad.",
        ],
      },
      {
        heading: "Gestión de cookies",
        body: [
          "El usuario puede aceptar, rechazar o configurar el uso de cookies no esenciales cuando dicha opción esté disponible en la plataforma. También puede bloquear o eliminar cookies desde la configuración de su navegador.",
          "La desactivación de cookies necesarias puede afectar el acceso o funcionamiento correcto de Kova.",
        ],
      },
      {
        heading: "Duración",
        body: [
          "Las cookies pueden ser de sesión, eliminándose al cerrar el navegador, o persistentes, conservándose por un periodo determinado según su finalidad o configuración del proveedor correspondiente.",
        ],
      },
      {
        heading: "Cambios a esta política",
        body: [
          "Kova podrá actualizar esta Política de Cookies para reflejar cambios tecnológicos, legales o de proveedores. La versión vigente estará disponible en la plataforma o en el sitio web de Kova.",
        ],
      },
      {
        heading: "Contacto",
        body: [
          `Para dudas relacionadas con el uso de cookies y tecnologías similares, puede contactarnos en: ${SUPPORT_EMAIL}.`,
        ],
      },
    ],
  },
};

export default function LegalPage({ variant }: LegalPageProps) {
  const data = content[variant];

  // Match body bg to legal-page bg so wide viewports don't show a seam.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.background;
    const prevBody = body.style.background;
    const legalBg = "#FBFBFD";
    html.style.background = legalBg;
    body.style.background = legalBg;
    return () => {
      html.style.background = prevHtml;
      body.style.background = prevBody;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--kova-paper, #FBFBFD)",
        color: "var(--kova-ink)",
        fontFamily: "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <header
        style={{
          padding: "24px 32px",
          borderBottom: "0.5px solid var(--kova-border)",
        }}
      >
        <Link to="/" style={{ display: "inline-flex", color: "var(--kova-ink)" }} aria-label="kova">
          <Logo size={24} circuitColor="currentColor" wordmarkColor="currentColor" coreColor="var(--kova-blue)" />
        </Link>
      </header>

      <article
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "64px 24px 96px",
        }}
      >
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--kova-tertiary)",
          }}
        >
          {data.eyebrow}
        </p>
        <h1
          style={{
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: "-0.8px",
            marginTop: 8,
            lineHeight: 1.15,
          }}
        >
          {data.title}
        </h1>
        <p style={{ fontSize: 13, color: "var(--kova-tertiary)", marginTop: 8 }}>
          Última actualización: {data.lastUpdated}
        </p>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--kova-muted)", marginTop: 24 }}>
          {data.intro}
        </p>

        <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 32 }}>
          {data.sections.map((section) => (
            <section key={section.heading}>
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  letterSpacing: "-0.3px",
                  color: "var(--kova-ink)",
                }}
              >
                {section.heading}
              </h2>
              {section.body.map((paragraph, idx) => (
                <p
                  key={idx}
                  style={{
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: "var(--kova-muted)",
                    marginTop: 12,
                  }}
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <footer
          style={{
            marginTop: 64,
            paddingTop: 24,
            borderTop: "0.5px solid var(--kova-border)",
            display: "flex",
            gap: 16,
            fontSize: 13,
            flexWrap: "wrap",
          }}
        >
          <Link to="/privacy" style={{ color: "var(--kova-muted)" }}>
            Aviso de privacidad
          </Link>
          <Link to="/terms" style={{ color: "var(--kova-muted)" }}>
            Términos y condiciones
          </Link>
          <Link to="/seguridad" style={{ color: "var(--kova-muted)" }}>
            Seguridad
          </Link>
          <Link to="/cookies" style={{ color: "var(--kova-muted)" }}>
            Cookies
          </Link>
          <Link to="/" style={{ color: "var(--kova-muted)", marginLeft: "auto" }}>
            ← Volver al inicio
          </Link>
        </footer>
      </article>
    </main>
  );
}
